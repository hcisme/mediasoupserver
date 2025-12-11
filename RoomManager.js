class RoomManager {
  constructor() {
    /**
     * rooms: Map<roomId, { router, peers: Set<socketId> }>
     */
    this.rooms = new Map();
    /**
     * peers: Map<socketId, {
     *   socket, roomId, transports: [], producers: [], consumers: []
     * }>
     */
    this.peers = new Map();
    this.worker = null;
  }

  setWorker(worker) {
    this.worker = worker;
  }

  /**
   * 获取 Peer 信息
   */
  getPeer(socketId) {
    return this.peers.get(socketId);
  }

  /**
   * 获取 Peer 所在的 Room 信息
   */
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  /**
   * 获取或创建房间 (Router)
   */
  async getOrCreateRouter(roomId, mediaCodecs) {
    let room = this.rooms.get(roomId);
    if (room) return room.router;

    // 创建新房间
    console.log(`[房间] 创建新路由, 房间号: ${roomId}`);
    const router = await this.worker.createRouter({ mediaCodecs });

    this.rooms.set(roomId, {
      router,
      peers: new Set()
    });

    return router;
  }

  /**
   * 用户加入
   */
  joinPeer(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found (Router not created)');

    // 记录 Peer 数据
    this.peers.set(socket.id, {
      socket,
      roomId,
      transports: [],
      producers: [],
      consumers: []
    });

    // 记录 Room 数据
    room.peers.add(socket.id);
    console.log(`[进房] 用户 ${socket.id} 加入了房间: ${roomId} (当前人数: ${room.peers.size})`);
  }

  /**
   * 用户离开与资源清理
   */
  removePeer(socketId) {
    const peer = this.peers.get(socketId);
    if (!peer) return;

    const { roomId, transports, producers, consumers } = peer;
    const room = this.rooms.get(roomId);

    console.log(`[清理] 开始清理用户 ${socketId} 的资源...`);

    // 1. 关闭 Mediasoup 资源
    consumers.forEach((c) => c.close());
    producers.forEach((p) => p.close());
    transports.forEach((t) => t.close());

    // 2. 从房间移除
    if (room) {
      room.peers.delete(socketId);
      console.log(`[房间] 用户离开房间 ${roomId} (剩余人数: ${room.peers.size})`);

      // 3. 房间空了则销毁 Router
      if (room.peers.size === 0) {
        console.log(`[房间] 房间 ${roomId} 为空，销毁 Router`);
        room.router.close();
        this.rooms.delete(roomId);
      }
    }

    // 4. 删除 Peer 记录
    this.peers.delete(socketId);
  }

  /**
   * 获取房间内"其他人"的 Producers (用于后进看先进)
   */
  getOtherProducers(socketId) {
    const peer = this.peers.get(socketId);
    if (!peer) return [];

    const room = this.rooms.get(peer.roomId);
    if (!room) return [];

    const producerList = [];
    room.peers.forEach((otherSocketId) => {
      if (otherSocketId !== socketId) {
        const otherPeer = this.peers.get(otherSocketId);
        otherPeer?.producers.forEach((producer) => {
          producerList.push({
            producerId: producer.id,
            socketId: otherSocketId,
            kind: producer.kind,
            paused: producer.paused
          });
        });
      }
    });
    return producerList;
  }

  /**
   * 添加 Transport
   */
  addTransport(socketId, transport) {
    const peer = this.peers.get(socketId);
    if (peer) peer.transports.push(transport);
  }

  /**
   * 获取 Transport
   */
  getTransport(socketId, transportId) {
    const peer = this.peers.get(socketId);
    return peer?.transports.find((t) => t.id === transportId);
  }

  /**
   * 添加 Producer
   */
  addProducer(socketId, producer) {
    const peer = this.peers.get(socketId);
    if (peer) peer.producers.push(producer);
  }

  /**
   * 添加 Consumer
   */
  addConsumer(socketId, consumer) {
    const peer = this.peers.get(socketId);
    if (peer) peer.consumers.push(consumer);
  }

  /**
   * 移除特定的 Consumer (当 Producer 关闭时)
   */
  removeConsumer(socketId, consumerId) {
    const peer = this.peers.get(socketId);
    if (peer) {
      peer.consumers = peer.consumers.filter((c) => c.id !== consumerId);
    }
  }
}

module.exports = RoomManager;
