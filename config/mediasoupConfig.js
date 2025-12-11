module.exports =  {
  PORT: 3000,
  // Mediasoup Worker 配置
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
  },
  // Router 媒体编解码配置
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: { 'x-google-start-bitrate': 1000 }
      },
    ]
  },
  // WebRTC Transport 配置
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0', // 监听服务器所有网卡
        // 如果是真机调试或部署云服务器，这里必须填公网IP
        announcedIp: '192.168.2.5' 
      }
    ],
    initialAvailableOutgoingBitrate: 1000000,
  }
};
