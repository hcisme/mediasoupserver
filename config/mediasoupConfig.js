const isProduction = process.env.NODE_ENV === 'production';

const announcedIp = isProduction ? process.env.PUBLIC_IP : process.env.LOCAL_IP;
const PORT = isProduction ? process.env.PUBLIC_PORT : process.env.LOCAL_PORT;

module.exports = {
  PORT,
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp', 'score', 'bwe']
  },
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
      }
    ]
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp
      }
    ],
    initialAvailableOutgoingBitrate: 1000000
  }
};
