const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios'); // 引入 axios 库来发送 HTTP 请求
const { v4: uuidv4 } = require('uuid');
const bodyParser = require('body-parser');
const moment = require('moment');

const app = express();
const server = http.createServer(app);

const port = process.env.PORT || 3000;
const wsUrl = 'wss://api.vecmul.com/ws';

let responses = {}; // 存储不同 rootMsgId 的响应内容
let connections = {}; // 存储不同 rootMsgId 的 HTTP 连接

// 模型映射
const modelMapping = {
  "gpt-3.5-turbo": "GPT-3.5",
  "gpt-4": "GPT-4",
  "gpt-4o": "GPT-4o",
  "claude-3-sonnet": "Claude3-Sonnet",
  "claude-3.5-sonnet": "Claude3.5-Sonnet",
  "claude-3-opus": "Claude3-Opus",
  "gemini-1.5-flash-latest": "gemini-1.5-flash",
  "gemini-1.5-pro": "gemini-1.5-pro"
};

// 使用 body-parser 中间件解析 JSON 请求体
app.use(bodyParser.json());

// 生成 completion id
function GenerateCompletionId(prefix = "chatcmpl-") {
  const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const length = 28;

  for (let i = 0; i < length; i++) {
    prefix += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return prefix;
}

// 获取 accessToken 的函数
async function getToken(refresh_token) {
  try {
    const url = 'https://api.vecmul.com/api/v1/auth/refresh';
    const headers = {
      'Cookie': `refresh_token=${refresh_token}`
    };

    const res = await axios.post(url, {}, { headers });
    return `Bearer ${res.data.accessToken}` || '';
  } catch (error) {
    console.error('Error getting token:', error);
    return '';
  }
}

// 身份验证中间件
function authMiddleware(req, res, next) {
  const authToken = process.env.AUTH_TOKEN;

  if (!process.env.LOGIN && authToken) {
    const reqAuthToken = req.headers.authorization;
    if (reqAuthToken && reqAuthToken === `Bearer ${authToken}`) {
      next();
    } else {
      res.sendStatus(401);
    }
  } else {
    next();
  }
}

// 配置 HTTP 路由
app.get('/', (req, res) => {
  res.type("html").send("<pre>Powered by vecmul\nAuthor: <a href='https://github.com/k0baya'>K0baya</a>" + "</pre>");
});

// 处理 POST 请求
app.post('/v1/chat/completions', authMiddleware, async (req, res) => {
  const { messages, model, stream } = req.body;
  if (!messages) {
    return res.status(400).send('Bad Request: Missing messages');
  }

  const mappedModel = modelMapping[model] || "GPT-3.5";
  const rootMsgId = uuidv4();
  const completionId = GenerateCompletionId();
  const wsMessage = {
    type: "CHAT",
    spaceName: "Free Space",
    message: {
      isAnonymous: true,
      rootMsgId: rootMsgId,
      public: false,
      model: mappedModel,
      order: 0,
      role: "user",
      content: JSON.stringify(messages),
      fileId: null,
      relatedLinkInfo: null,
      messageType: "MESSAGE",
      fileKey: null,
      language: "zh"
    }
  };

  let wsClient;
  let accessToken = '';
  if (process.env.LOGIN) {
    const authHeader = req.headers.authorization || '';
    const refreshToken = authHeader.split(' ')[1];
    accessToken = await getToken(refreshToken);
    const wsUrlWithToken = `${wsUrl}?token=${accessToken}`;
    console.log(`Websocket Server: ${wsUrlWithToken} `);
    wsClient = new WebSocket(wsUrlWithToken);
  } else {
    wsClient = new WebSocket(wsUrl);
  }

  let responseSent = false;
  let responseTimer;

  function sendResponse(responseData) {
    if (!responseSent) {
      res.json(responseData);
      responseSent = true;
      wsClient.close();
      clearTimeout(responseTimer); // 清除超时计时器
    }
  }

  function endStream(rootMsgId, completionId, model) {
    if (connections[rootMsgId]) {
      const endStreamResponse = {
        id: completionId,
        object: "chat.completion.chunk",
        created: moment().unix(),
        model: model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: "stop"
        }]
      };
      connections[rootMsgId].res.write(`data: ${JSON.stringify(endStreamResponse)}\n\n`);
      connections[rootMsgId].res.end();
      delete connections[rootMsgId];
    }
  }

  wsClient.on('open', function open() {
    console.log('Connected to WebSocket server');
    wsClient.send(JSON.stringify(wsMessage));

    responseTimer = setTimeout(() => {
      const timeoutResponse = {
        id: completionId,
        model: model,
        object: "chat.completion",
        created: moment().unix(),
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "I'm really sorry. Due to high usage, access is currently restricted. We will resolve the cost issue as soon as possible."
          },
          finish_reason: "stop"
        }],
        usage: {
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null
        }
      };

      if (stream) {
        if (connections[rootMsgId]) {
          connections[rootMsgId].res.write(`data: ${JSON.stringify(timeoutResponse)}\n\n`);
          endStream(rootMsgId, completionId, model);
        }
      } else {
        sendResponse(timeoutResponse);
      }
    }, 10000);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      connections[rootMsgId] = {
        res: res,
        streaming: true,
        completionId: completionId,
        model: model
      };

    } else {
      const checkResponse = setInterval(() => {
        if (responses[rootMsgId] && responses[rootMsgId].finished) {
          clearInterval(checkResponse);
          clearTimeout(responseTimer);

          const responseData = {
            id: completionId,
            model: model,
            object: "chat.completion",
            created: moment().unix(),
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: responses[rootMsgId].content
              },
              finish_reason: "stop"
            }],
            usage: {
              prompt_tokens: null,
              completion_tokens: null,
              total_tokens: null
            }
          };

          delete responses[rootMsgId];
          sendResponse(responseData);
        }
      }, 100);
    }
  });

  wsClient.on('message', function incoming(data) {
    console.log('Received: %s', data);
    const message = JSON.parse(data);

    if (message.type !== "HELLO" && message.type !== "AI_STREAM_MESSAGE" && message.type !== "NEW_CHAT_CREATED") {
      if (stream) {
        if (connections[rootMsgId]) {
          connections[rootMsgId].res.write(`data: ${JSON.stringify(message)}\n\n`);
          endStream(rootMsgId, completionId, model);
        }
      } else {
        const messageContent = message.data.message || data;
        sendResponse({
          id: completionId,
          model: model,
          object: "chat.completion",
          created: moment().unix(),
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: typeof messageContent === 'string' ? messageContent : JSON.stringify(messageContent)
            },
            finish_reason: "stop"
          }],
          usage: {
            prompt_tokens: null,
            completion_tokens: null,
            total_tokens: null
          }
        });
      }
    } else if (message.type === "AI_STREAM_MESSAGE" && message.data.role === "assistant") {
      const rootId = message.rootMsgId;
      const content = message.data.content;

      if (!responses[rootId]) {
        responses[rootId] = { content: "", finished: false };
      }

      responses[rootId].content += content;

      if (connections[rootId] && connections[rootId].streaming) {
        const streamResponse = {
          id: connections[rootId].completionId,
          object: "chat.completion.chunk",
          created: moment().unix(),
          model: connections[rootId].model,
          choices: [{
            index: 0,
            delta: { content: content }
          }]
        };
        connections[rootId].res.write(`data: ${JSON.stringify(streamResponse)}\n\n`);
      }

      if (message.data.finishedReason === "stop") {
        responses[rootId].finished = true;

        if (connections[rootId] && connections[rootId].streaming) {
          endStream(rootId, connections[rootId].completionId, connections[rootId].model);
        } else {
          clearTimeout(responseTimer); // 清除超时计时器
          const responseData = {
            id: completionId,
            model: model,
            object: "chat.completion",
            created: moment().unix(),
            choices: [{
              index: 0,
              message: {
                role: "assistant",
                content: responses[rootId].content
              },
              finish_reason: "stop"
            }],
            usage: {
              prompt_tokens: null,
              completion_tokens: null,
              total_tokens: null
            }
          };
          delete responses[rootId];
          sendResponse(responseData);
        }
      }
    }
  });

  wsClient.on('close', function close() {
    console.log('Disconnected from WebSocket server');
  });

  wsClient.on('error', function error(err) {
    console.error('WebSocket error:', err);
    if (!responseSent) {
      res.status(500).send('Internal Server Error');
      responseSent = true;
      clearTimeout(responseTimer); // 清除超时计时器
    }
  });
});

app.use((req, res, next) => {
  res.status(404).send('404 Not Found. The API endpoint is /v1/chat/completions');
});

// 启动服务器
server.listen(port, () => {
  console.log(`💡 Server is running at http://localhost:${port}`);
});
