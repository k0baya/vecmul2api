## Vecmul to API
## Features

- **Streaming Response**: The API supports streaming response, so you can get the response as soon as it's available.
- **API Endpoint Compatibility**: Full alignment with official OpenAI API endpoints, ensuring hassle-free integration with existing OpenAI libraries.
- **Complimentary Access**: No charges for API usage, making advanced AI accessible to everyone even **without an API key**.

## Installing/Self-Hosting Guide

### Using docker

1. Ensure Docker is installed by referring to the [Docker Installation Docs](https://docs.docker.com/engine/install/).

2. Clone repository

3. Edit the `.env` file.

| Key        | Default Value | Compulsory | Notice                                               |
| ---------- | ------------- | ---------- | ---------------------------------------------------- |
| PORT       | 3000          | No         | Listening Port                                       |
| AUTH_TOKEN |               | No         | Authentication secret key for `/v1/chat/completions` |

4. Run the following command:
   ```bash
   docker compose up -d
   ```

5. Done! You can now connect to your local server's API at:
   ```
   http://localhost:3000/v1/chat/completions
   ```
   Note that the base URL is `http://localhost:PORT/v1`.

### From source code

1. Edit the `.env` file.

| Key        | Default Value | Compulsory | Notice                                               |
| ---------- | ------------- | ---------- | ---------------------------------------------------- |
| PORT       | 3000          | No         | Listening Port                                       |
| AUTH_TOKEN |               | No         | Authentication secret key for `/v1/chat/completions` |

2. Run the following command:
   ```bash
   npm install
   npm run start
   ```

3. Done! You can now connect to your local server's API at:
   ```
   http://localhost:PORT/v1/chat/completions
   ```
   Note that the base URL is `http://localhost:PORT/v1`.

## Example Usage with curl

```bash
curl --location 'http(s)://localhost:PORT/v1/chat/completions' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer AUTH_TOKEN' \
--data '{
  "model": "gpt-3.5-turbo",
  "stream": true,
  "messages": [{"role": "user", "content": "Tell me a story about socialism."}]
}'
```