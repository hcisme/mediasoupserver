require('module-alias/register');
require('dotenv').config();
const { createWorker } = require('mediasoup');
const http = require('http');
const { Server } = require('socket.io');
const express = require('express');
// 本地模块
const {
  PORT,
  worker: workerConfig,
  router: routerConfig,
  webRtcTransport: webRtcTransportConfig
} = require('@/config/mediasoupConfig');
const RoomManager = require('./RoomManager');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const roomManager = new RoomManager();

async function runMediasoupWorker() {
  try {
    const worker = await createWorker(workerConfig);
    // 把 worker 注入给管理器
    roomManager.setWorker(worker);

    worker.on('died', () => {
      console.error('[错误] Mediasoup Worker 异常，2秒后退出...');
      setTimeout(() => process.exit(1), 2000);
    });
  } catch (error) {
    console.error('[错误] 启动 Worker 失败:', error);
  }
}

io.on('connection', (socket) => {
  // 加入房间
  socket.on('joinRoom', async ({ roomId }, callback) => {
    try {
      const router = await roomManager.getOrCreateRouter(roomId, routerConfig.mediaCodecs);

      socket.join(roomId);
      roomManager.joinPeer(socket, roomId);

      socket.data.roomId = roomId;
      socket.to(roomId).emit('peerJoined', { socketId: socket.id });

      // 获取现有的 Producers
      const existingProducers = roomManager.getOtherProducers(socket.id);
      callback?.({
        rtpCapabilities: router.rtpCapabilities,
        existingProducers: existingProducers
      });
    } catch (error) {
      console.error(`[错误] 加入房间失败:`, error);
      callback?.({ error: error.message });
    }
  });

  // 创建 WebRTC Transport
  socket.on('createWebRtcTransport', async (_, callback) => {
    const peer = roomManager.getPeer(socket.id);
    if (!peer) return callback({ error: '用户不存在' });

    try {
      const room = roomManager.getRoom(peer.roomId);
      const transport = await room.router.createWebRtcTransport(webRtcTransportConfig);

      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') transport.close();
      });

      transport.on('close', () => {
        console.log(`[传输] Transport 关闭 (ID: ${transport.id})`);
      });

      // 保存到 Manager
      roomManager.addTransport(socket.id, transport);

      callback?.({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });
    } catch (error) {
      console.error(`[错误] 创建 Transport 失败:`, error);
      callback?.({ error: error.message });
    }
  });

  // 连接 Transport
  socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
    const transport = roomManager.getTransport(socket.id, transportId);
    if (!transport) return callback?.({ error: `未找到 ID 为 "${transportId}" 的传输通道` });

    await transport.connect({ dtlsParameters });
    callback?.();
  });

  // 发布 (Produce)
  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    const transport = roomManager.getTransport(socket.id, transportId);
    if (!transport) return callback?.({ error: `未找到 ID 为 "${transportId}" 的传输通道` });

    try {
      const producer = await transport.produce({ kind, rtpParameters });

      // 保存到 Manager
      roomManager.addProducer(socket.id, producer);

      console.log(`[推流] 用户 ${socket.id} 发布了 ${kind} 流`);

      const peer = roomManager.getPeer(socket.id);
      // 广播通知房间其他人
      socket.to(peer.roomId).emit('newProducer', {
        producerId: producer.id,
        socketId: socket.id,
        kind: producer.kind,
        paused: producer.paused
      });

      // 监听网络质量 (Score)
      producer.on('score', (score) => {
        // 广播通知房间其他人
        socket.to(peer.roomId).emit('producerScore', {
          producerId: producer.id,
          score: score
        });
        socket.emit('producerScore', {
          producerId: producer.id,
          score: score
        });
      });

      producer.on('transportclose', () => producer.close());
      callback?.({ id: producer.id });
    } catch (error) {
      console.error(`[错误] 推流失败:`, error);
    }
  });

  // 订阅 (Consume)
  socket.on('consume', async ({ producerId, rtpCapabilities, transportId }, callback) => {
    const peer = roomManager.getPeer(socket.id);
    const room = roomManager.getRoom(peer?.roomId);
    const transport = roomManager.getTransport(socket.id, transportId);

    if (!room?.router?.canConsume({ producerId, rtpCapabilities })) {
      return callback?.({ error: 'Router 无法消费此流 (Codec 不兼容)' });
    }

    try {
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true
      });

      // 保存到 Manager
      roomManager.addConsumer(socket.id, consumer);

      // 监听 Producer 关闭
      consumer.on('producerclose', () => {
        console.log(`[拉流] Producer 关闭，通知 Consumer (ID: ${consumer.id})`);

        socket.emit('consumerClosed', { consumerId: consumer.id });

        // 使用 Manager 清理
        roomManager.removeConsumer(socket.id, consumer.id);
        consumer.close();
      });

      callback?.({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        socketId: socket.id
      });
    } catch (error) {
      console.error(`[错误] 订阅失败:`, error);
    }
  });

  // 恢复 (Resume)
  socket.on('resume', async ({ consumerId }, callback) => {
    const peer = roomManager.getPeer(socket.id);
    const consumer = peer?.consumers.find((c) => c.id === consumerId);
    if (consumer) {
      await consumer.resume();
      callback?.();
    }
  });

  // 暂停推流 (关闭麦克风/关闭摄像头)
  socket.on('pauseProducer', async ({ producerId }, callback) => {
    const peer = roomManager.getPeer(socket.id);
    const producer = peer?.producers.find((p) => p.id === producerId);

    if (producer) {
      await producer.pause();

      socket.to(peer.roomId).emit('producerPaused', {
        producerId: producerId,
        socketId: socket.id,
        kind: producer.kind
      });

      callback?.();
    }
  });

  // 恢复推流 (打开麦克风/打开摄像头)
  socket.on('resumeProducer', async ({ producerId }, callback) => {
    const peer = roomManager.getPeer(socket.id);
    const producer = peer?.producers.find((p) => p.id === producerId);

    if (producer) {
      await producer.resume();

      socket.to(peer.roomId).emit('producerResumed', {
        producerId: producerId,
        socketId: socket.id,
        kind: producer.kind
      });

      callback?.();
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      console.log(`[断开] 用户 ${socket.id} 退出了房间: ${roomId}`);
      roomManager.removePeer(socket.id);
      socket.to(roomId).emit('peerLeave', { socketId: socket.id });
    }
  });
});

httpServer.listen(PORT, async () => {
  await runMediasoupWorker();
  console.log(`[系统] Server Running At http://127.0.0.1:${PORT}`);
});
