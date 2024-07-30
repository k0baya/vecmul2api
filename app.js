const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid'); // 引入 uuid 库
const bodyParser = require('body-parser'); // 引入 body-parser 解析请求体
const moment = require('moment'); // 引入 moment.js 库来处理时间戳

const app = express();
const server = http.createServer(app);

const port = process.env.PORT || 3000;
const wsUrl = 'wss://api.vecmul.com/ws';

let rootMsgId; // 变量存储生成的 UUID
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

// 创建 WebSocket 客户端连接
const wsClient = new WebSocket(wsUrl);

wsClient.on('open', function open() {
  console.log('Connected to WebSocket server');
});

wsClient.on('message', function incoming(data) {
  console.log('Received: %s', data);
  const message = JSON.parse(data);

  if (message.type === "AI_STREAM_MESSAGE" && message.data.role === "assistant") {
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

    if (message.data.finishedReason === "end_turn") {
      responses[rootId].finished = true;

      if (connections[rootId] && connections[rootId].streaming) {
        const endStreamResponse = {
          id: connections[rootId].completionId,
          object: "chat.completion.chunk",
          created: moment().unix(),
          model: connections[rootId].model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: "stop"
          }]
        };
        connections[rootId].res.write(`data: ${JSON.stringify(endStreamResponse)}\n\n`);
        connections[rootId].res.end();
        delete connections[rootId];
      }
    }
  }
});

wsClient.on('close', function close() {
  console.log('Disconnected from WebSocket server');
});

wsClient.on('error', function error(err) {
  console.error('WebSocket error:', err);
});

// 生成 completion id
function GenerateCompletionId(prefix = "chatcmpl-") {
  const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const length = 28;

  for (let i = 0; i < length; i++) {
    prefix += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return prefix;
}

// 身份验证中间件
function authMiddleware(req, res, next) {
  const authToken = process.env.AUTH_TOKEN;

  if (authToken) {
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
app.post('/v1/chat/completions', authMiddleware, (req, res) => {
  // 获取请求体中的 messages 和 model 部分
  const { messages, model, stream } = req.body;
  if (!messages) {
    return res.status(400).send('Bad Request: Missing messages');
  }

  // 根据 model 字段进行映射，默认使用 "GPT-3.5"
  const mappedModel = modelMapping[model] || "GPT-3.5";

  // 生成随机 UUID 并存储在 rootMsgId 变量中
  rootMsgId = uuidv4();
  const completionId = GenerateCompletionId();

  // 构造 WebSocket 消息并发送
  const wsMessage = {
    type: "CHAT",
    spaceName: "Free Space",
    message: {
      isAnonymous: true,
      rootMsgId: rootMsgId, // 使用生成的 UUID
      public: false,
      model: mappedModel, // 使用映射后的 model
      order: 0,
      role: "user",
      content: JSON.stringify(messages), // 将 messages 部分作为 content
      fileId: null,
      relatedLinkInfo: null,
      messageType: "MESSAGE",
      fileKey: null,
      language: "zh"
    }
  };

  if (wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify(wsMessage));

    // 超时设置
    const timeout = setTimeout(() => {
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

      res.json(timeoutResponse);
    }, 10000); // 10秒超时

    // 检查是否需要流式返回
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

      // 保持连接打开
    } else {
      // 定期检查响应是否已完成
      const checkResponse = setInterval(() => {
        if (responses[rootMsgId] && responses[rootMsgId].finished) {
          clearInterval(checkResponse);
          clearTimeout(timeout); // 如果响应已完成，清除超时

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

          delete responses[rootMsgId]; // 清除已完成的响应数据
          res.json(responseData);
        }
      }, 100);
    }
  } else {
    res.status(500).send('WebSocket connection is not open');
  }
});

app.use((req, res, next) => {
  res.status(404).send('404 Not Found. The API endpoint is /v1/chat/completions');
});

// 启动服务器
server.listen(port, () => {
  console.log(`💡 Server is running at http://localhost:${port}`);
});

