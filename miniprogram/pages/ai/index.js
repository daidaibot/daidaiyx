Page({
  data: {
    // model = 直连云开发里配置的大模型（DeepSeek / 混元）
    // bot = 使用云开发 Agent（更强，需先在云开发平台建 Agent）
    chatMode: 'model',
    showBotAvatar: true,
    agentConfig: {
      botId: '',
      allowWebSearch: true,
      allowUploadFile: true,
      allowPullRefresh: true,
      allowUploadImage: true,
      showToolCallDetail: true,
      allowMultiConversation: true,
      allowVoice: true,
      showBotName: true,
    },
    modelConfig: {
      modelProvider: 'deepseek',
      quickResponseModel: 'deepseek-v3',
      logo: '',
      welcomeMsg: '你好，我是呆呆网络 AI。有什么想聊的？',
    },
  },
});
