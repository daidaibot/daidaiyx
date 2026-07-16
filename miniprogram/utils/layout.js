/**
 * 手机 / 平板 / 电脑 布局参数
 * 宽屏（≥600px）启用居中限宽与更合理的顶栏留白
 * 优先用新 API（getWindowInfo / getDeviceInfo），避免 getSystemInfo 提示
 */
function readWindow() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      return wx.getWindowInfo();
    }
  } catch (e) {
    /* fall through */
  }
  try {
    return wx.getSystemInfoSync();
  } catch (e) {
    return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20 };
  }
}

function readDevice() {
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      return wx.getDeviceInfo();
    }
  } catch (e) {
    /* fall through */
  }
  return {};
}

function getLayout() {
  let info = {};
  try {
    info = readWindow() || {};
  } catch (e) {
    info = { windowWidth: 375, windowHeight: 667, statusBarHeight: 20 };
  }
  const device = readDevice();
  const windowWidth = Number(info.windowWidth) || 375;
  const windowHeight = Number(info.windowHeight) || 667;
  const isWide = windowWidth >= 600;
  const isTablet = windowWidth >= 600 && windowWidth < 960;
  const isPc = windowWidth >= 960;
  const platform = String(device.platform || info.platform || '').toLowerCase();

  let statusBarHeight = Number(info.statusBarHeight) || 0;
  // 电脑微信常见 statusBarHeight=0，给一点顶栏呼吸感
  if (isWide && statusBarHeight < 12) statusBarHeight = 12;
  if (!statusBarHeight) statusBarHeight = 20;

  return {
    windowWidth,
    windowHeight,
    isWide,
    isTablet,
    isPc,
    platform,
    statusBarHeight,
    heroPadTop: statusBarHeight + (isWide ? 52 : 72),
  };
}

module.exports = {
  getLayout,
  readWindow,
  readDevice,
};
