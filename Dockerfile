FROM node:20-slim

WORKDIR /app

# 安装构建原生模块所需的工具（better-sqlite3 需要）
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY package.json ./

# 安装依赖
RUN npm install

# 复制源码
COPY tsconfig.json ./
COPY src/ ./src/

# 编译 TypeScript
RUN npx tsc

# 创建数据目录
RUN mkdir -p /data

# 暴露端口
EXPOSE 8080

# 启动
ENV PORT=8080
CMD ["node", "dist/index.js"]