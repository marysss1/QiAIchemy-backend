# QiAIchemy Backend

Standalone TypeScript backend for QiAIchemy.

## Stack

- Node.js + Express
- MongoDB + Mongoose
- JWT Authentication
- TypeScript

## Setup

```bash
npm install
cp .env.example .env
```

Update `.env`:

```env
HOST=0.0.0.0
PORT=2818
MONGODB_URI=mongodb://127.0.0.1:27017/qiaichemy
JWT_SECRET=replace-with-a-very-long-random-secret
```

Default API base URL:

- Local: `http://localhost:2818`
- External: `http://<your-server-ip>:2818`

## Run

```bash
npm run dev
```

## Build + Start

```bash
npm run build
npm start
```

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `GET /health`
