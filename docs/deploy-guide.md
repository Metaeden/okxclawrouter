# OKXClawRouter 后端部署教程

> 本文档覆盖从零开始将 OKXClawRouter 后端服务部署到云服务器的完整流程。

---

## 目录

1. [前置准备](#1-前置准备)
2. [获取必要的密钥](#2-获取必要的密钥)
3. [服务器环境配置](#3-服务器环境配置)
4. [方式一：Docker 部署（推荐）](#4-方式一docker-部署推荐)
5. [方式二：直接部署（无 Docker）](#5-方式二直接部署无-docker)
6. [Nginx 反向代理 + HTTPS](#6-nginx-反向代理--https)
7. [进程守护（PM2 / systemd）](#7-进程守护pm2--systemd)
8. [验证部署](#8-验证部署)
9. [配置本地 Proxy 连接后端](#9-配置本地-proxy-连接后端)
10. [运维与监控](#10-运维与监控)
11. [常见问题](#11-常见问题)

---

## 1. 前置准备

### 你需要

| 项目 | 说明 |
|------|------|
| 一台云服务器 | 推荐 2C4G 起步（Ubuntu 22.04/24.04 LTS），带公网 IP |
| 域名（可选但推荐） | 用于 HTTPS，如 `api.yourdomain.com` |
| OKX 开发者账号 | 获取 Facilitator API 密钥 |
| OpenRouter 账号 | 获取 API Key |
| 一个 X Layer 钱包地址 | 接收 USDC 付款的收款地址 |

### 服务器最低要求

- CPU: 1 核
- 内存: 1 GB（推荐 2 GB）
- 磁盘: 10 GB
- 系统: Ubuntu 22.04+ / Debian 12+ / CentOS 9+（本教程以 Ubuntu 为例）
- 端口: 80, 443（HTTP/HTTPS）, 4002（可选直接暴露）

---

## 2. 获取必要的密钥

### 2.1 OKX Facilitator 密钥

1. 前往 [OKX 开发者平台](https://www.okx.com/web3/build)
2. 创建应用 → 获取 API Key、Secret Key、Passphrase
3. 确保应用已启用 x402 / Facilitator 权限

记下以下三个值：
```
OKX_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
OKX_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OKX_PASSPHRASE=your-passphrase
```

### 2.2 OpenRouter API Key

1. 前往 [openrouter.ai](https://openrouter.ai)
2. 注册/登录 → Keys → Create Key
3. **设置 Monthly Spend Limit**（建议先设 $50，防止异常调用）

```
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 2.3 收款钱包地址

你需要一个 X Layer 网络（Chain ID: 196）上的钱包地址来接收用户的 USDC 付款。

```
PAY_TO_ADDRESS=0xYourWalletAddressHere
```

> **安全提醒：** 以上所有密钥都只应存放在服务器环境变量中，绝不要写入代码或提交到 Git。

---

## 3. 服务器环境配置

### 3.1 登录服务器

```bash
ssh root@your-server-ip
```

### 3.2 基础更新

```bash
apt update && apt upgrade -y
```

### 3.3 安装 Git

```bash
apt install -y git
```

### 3.4 创建部署用户（推荐，不要用 root 跑服务）

```bash
adduser --disabled-password deploy
usermod -aG sudo deploy
su - deploy
```

### 3.5 拉取代码

```bash
cd ~
git clone https://github.com/<your-org>/okxclawrouter.git
cd okxclawrouter/backend
```

---

## 4. 方式一：Docker 部署（推荐）

### 4.1 安装 Docker

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 允许非 root 用户使用 docker
sudo usermod -aG docker deploy
# 重新登录使权限生效
exit
su - deploy
```

### 4.2 创建环境变量文件

```bash
cd ~/okxclawrouter/backend
cp .env.example .env
```

编辑 `.env`，填入真实值：

```bash
nano .env
```

```env
# OKX Facilitator 密钥
OKX_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
OKX_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OKX_PASSPHRASE=your-passphrase

# 你的 X Layer 收款钱包地址
PAY_TO_ADDRESS=0xYourWalletAddressHere

# OpenRouter API Key
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 服务端口
PORT=4002
```

保存退出（`Ctrl+O` → `Enter` → `Ctrl+X`）。

**锁定 .env 文件权限：**

```bash
chmod 600 .env
```

### 4.3 构建 Docker 镜像

```bash
cd ~/okxclawrouter/backend
docker build -t okxclawrouter-backend .
```

构建过程大约 1-2 分钟。成功后会看到：

```
Successfully tagged okxclawrouter-backend:latest
```

### 4.4 启动容器

```bash
docker run -d \
  --name okxclawrouter \
  --restart unless-stopped \
  --env-file .env \
  -p 4002:4002 \
  okxclawrouter-backend
```

参数说明：
- `-d` — 后台运行
- `--restart unless-stopped` — 异常退出自动重启
- `--env-file .env` — 从文件读取环境变量
- `-p 4002:4002` — 映射端口

### 4.5 检查运行状态

```bash
# 查看容器状态
docker ps

# 查看日志
docker logs okxclawrouter

# 实时查看日志
docker logs -f okxclawrouter
```

正常启动日志：

```
x402 resource server initialized (network: eip155:196)
OKXClawRouter Backend running on :4002
  Free route:  POST /v1/free/chat/completions
  Paid route:  POST /v1/paid/chat/completions (x402)
  Models:      GET  /v1/models
  Health:      GET  /health
```

### 4.6 常用 Docker 命令

```bash
# 停止
docker stop okxclawrouter

# 重启
docker restart okxclawrouter

# 更新代码后重新部署
cd ~/okxclawrouter && git pull
cd backend
docker build -t okxclawrouter-backend .
docker stop okxclawrouter && docker rm okxclawrouter
docker run -d \
  --name okxclawrouter \
  --restart unless-stopped \
  --env-file .env \
  -p 4002:4002 \
  okxclawrouter-backend
```

---

## 5. 方式二：直接部署（无 Docker）

如果你不想用 Docker，也可以直接在服务器上跑 Node.js。

### 5.1 安装 Node.js 22

```bash
# 使用 NodeSource 官方源
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 验证
node -v   # 应该输出 v22.x.x
npm -v
```

### 5.2 安装依赖并构建

```bash
cd ~/okxclawrouter/backend
npm ci
npm run build
```

### 5.3 创建环境变量文件

同上面 4.2 节，创建并编辑 `.env` 文件。

### 5.4 启动服务

```bash
# 加载 .env 并启动
export $(grep -v '^#' .env | xargs)
npm start
```

> 直接这样启动只适合测试。生产环境请使用下面的 PM2 或 systemd 来守护进程。

---

## 6. Nginx 反向代理 + HTTPS

**强烈推荐配置 Nginx + HTTPS**，原因：
- x402 支付签名通过 HTTP header 传输，必须用 HTTPS 防止中间人窃取
- 提供域名访问（而不是 `IP:4002`）
- 方便后续添加限流、日志等

### 6.1 安装 Nginx

```bash
sudo apt install -y nginx
```

### 6.2 配置反向代理

```bash
sudo nano /etc/nginx/sites-available/okxclawrouter
```

写入：

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;  # 改成你的域名

    # 安全头
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;

    location / {
        proxy_pass http://127.0.0.1:4002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE / 流式传输支持（重要！LLM 响应是流式的）
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;

        # 超时设置（LLM 响应可能比较慢）
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/okxclawrouter /etc/nginx/sites-enabled/
sudo nginx -t          # 检查配置语法
sudo systemctl reload nginx
```

### 6.3 配置 HTTPS（Let's Encrypt 免费证书）

```bash
# 安装 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 申请证书（确保域名已解析到服务器 IP）
sudo certbot --nginx -d api.yourdomain.com

# 按提示操作：
# - 输入邮箱
# - 同意条款
# - 选择是否重定向 HTTP → HTTPS（推荐选 2: Redirect）
```

证书会自动续期。可以测试续期：

```bash
sudo certbot renew --dry-run
```

### 6.4 验证 HTTPS

```bash
curl https://api.yourdomain.com/health
```

应返回：

```json
{"status":"ok","timestamp":"2026-04-13T..."}
```

---

## 7. 进程守护（PM2 / systemd）

### 方案 A：PM2（推荐，如果不用 Docker）

```bash
# 安装 PM2
sudo npm install -g pm2

# 启动服务
cd ~/okxclawrouter/backend
pm2 start dist/server.js \
  --name okxclawrouter \
  --env-file .env

# 查看状态
pm2 status

# 查看日志
pm2 logs okxclawrouter

# 设置开机自启
pm2 startup
pm2 save
```

PM2 常用命令：

```bash
pm2 restart okxclawrouter   # 重启
pm2 stop okxclawrouter      # 停止
pm2 delete okxclawrouter    # 删除
pm2 monit                   # 实时监控面板
```

### 方案 B：systemd

```bash
sudo nano /etc/systemd/system/okxclawrouter.service
```

写入：

```ini
[Unit]
Description=OKXClawRouter Backend
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/okxclawrouter/backend
EnvironmentFile=/home/deploy/okxclawrouter/backend/.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable okxclawrouter
sudo systemctl start okxclawrouter

# 查看状态
sudo systemctl status okxclawrouter

# 查看日志
sudo journalctl -u okxclawrouter -f
```

---

## 8. 验证部署

在你的本地电脑上执行以下命令，逐步验证后端是否正常工作。

### 8.1 健康检查

```bash
curl https://api.yourdomain.com/health
```

期望返回：
```json
{"status":"ok","timestamp":"2026-04-13T12:00:00.000Z"}
```

### 8.2 模型列表

```bash
curl https://api.yourdomain.com/v1/models | jq .
```

期望返回 6 个模型（3 free + 3 paid）。

### 8.3 免费模型调用测试

```bash
curl -X POST https://api.yourdomain.com/v1/free/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "free/deepseek-chat",
    "messages": [{"role": "user", "content": "Say hello in one word"}],
    "max_tokens": 10
  }'
```

应返回 DeepSeek 的回答。

### 8.4 付费模型 402 测试

```bash
curl -v -X POST https://api.yourdomain.com/v1/paid/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "paid/claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 10
  }'
```

应返回 **HTTP 402** 以及 `PAYMENT-REQUIRED` 头 — 这说明 x402 支付墙正常工作。本地 Proxy 会自动处理这个 402，完成支付并重发请求。

### 8.5 流式传输测试

```bash
curl -N -X POST https://api.yourdomain.com/v1/free/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "free/deepseek-chat",
    "messages": [{"role": "user", "content": "Count from 1 to 5"}],
    "stream": true
  }'
```

应看到 SSE 格式的流式数据逐行输出。

---

## 9. 配置本地 Proxy 连接后端

部署完成后，在你的本地机器上修改 Proxy 的后端地址：

### 方式一：环境变量

```bash
export OKX_ROUTER_BACKEND=https://api.yourdomain.com
okxclawrouter
```

### 方式二：修改 launch 脚本

编辑 `~/.local/bin/okxclawrouter`，把 `OKX_ROUTER_BACKEND` 改成你的域名：

```bash
export OKX_ROUTER_BACKEND="https://api.yourdomain.com"
```

然后在你的 AI 工具中配置：

```
API Base URL: http://localhost:8402/v1
```

链路就通了：`AI 工具 → 本地 Proxy(:8402) → 你的后端(api.yourdomain.com) → OpenRouter`

---

## 10. 运维与监控

### 10.1 日志查看

```bash
# Docker 方式
docker logs -f okxclawrouter --tail 100

# PM2 方式
pm2 logs okxclawrouter --lines 100

# systemd 方式
sudo journalctl -u okxclawrouter -f --no-pager
```

每条请求日志格式：
```
POST /v1/free/chat/completions 200 1523ms model=free/deepseek-chat
```

### 10.2 更新部署

```bash
cd ~/okxclawrouter
git pull

# Docker 方式
cd backend
docker build -t okxclawrouter-backend .
docker stop okxclawrouter && docker rm okxclawrouter
docker run -d --name okxclawrouter --restart unless-stopped \
  --env-file .env -p 4002:4002 okxclawrouter-backend

# PM2 方式
cd backend && npm ci && npm run build
pm2 restart okxclawrouter

# systemd 方式
cd backend && npm ci && npm run build
sudo systemctl restart okxclawrouter
```

### 10.3 安全加固

```bash
# 只允许 Nginx 访问 4002 端口，外部不能直连
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw deny 4002/tcp     # 阻止外部直连后端
sudo ufw enable
```

### 10.4 OpenRouter 费用监控

- 登录 [openrouter.ai/activity](https://openrouter.ai/activity) 查看用量和费用
- 在 Settings → Limits 中设置月消费上限
- 定期轮换 API Key（建议每 90 天）

### 10.5 简易健康监控脚本

创建 `/home/deploy/check-health.sh`：

```bash
#!/bin/bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4002/health)
if [ "$STATUS" != "200" ]; then
  echo "[$(date)] OKXClawRouter health check FAILED (status=$STATUS)" >> /var/log/okxclawrouter-health.log
  # 可选：发送告警（邮件、Telegram、Slack 等）
fi
```

添加 crontab 每 5 分钟执行一次：

```bash
chmod +x /home/deploy/check-health.sh
crontab -e
# 添加：
# */5 * * * * /home/deploy/check-health.sh
```

---

## 11. 常见问题

### Q: 启动报 `FATAL: Missing required env var`

`.env` 文件缺少必要变量。检查是否全部填写：

```bash
cat .env | grep -v '^#' | grep -v '^$'
```

必须有：`OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `PAY_TO_ADDRESS`, `OPENROUTER_API_KEY`

### Q: 免费路由返回 502

OpenRouter 暂时不可用或 API Key 无效。检查：

```bash
# 直接测试 OpenRouter 连通性
curl https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" | head -c 200
```

### Q: 付费路由没有返回 402

x402 中间件初始化失败。查看启动日志里有没有 `x402 resource server initialized`。如果没有，检查 OKX 密钥是否正确。

### Q: 流式响应被截断

Nginx 缓冲了 SSE 流。确认 Nginx 配置中有：

```nginx
proxy_buffering off;
proxy_cache off;
```

### Q: Docker 容器反复重启

```bash
docker logs okxclawrouter
```

看最后几行报错。常见原因：`.env` 变量缺失、端口被占用。

### Q: 如何修改端口？

修改 `.env` 中的 `PORT` 值，同时修改 Docker 的 `-p` 映射和 Nginx 的 `proxy_pass`。

---

## 部署检查清单

完成以下所有项才算部署成功：

- [ ] `.env` 文件已创建且权限为 600
- [ ] 所有 5 个必需环境变量已填写
- [ ] 服务已启动且日志显示 `OKXClawRouter Backend running on :4002`
- [ ] `GET /health` 返回 200
- [ ] `GET /v1/models` 返回 6 个模型
- [ ] `POST /v1/free/chat/completions` 正常返回 AI 回答
- [ ] `POST /v1/paid/chat/completions` 返回 HTTP 402
- [ ] 流式请求 (`stream: true`) 正常输出
- [ ] Nginx + HTTPS 已配置（如需公网访问）
- [ ] 防火墙已配置（4002 端口不对外暴露）
- [ ] 进程守护已配置（Docker / PM2 / systemd）
- [ ] OpenRouter 已设置月消费上限
