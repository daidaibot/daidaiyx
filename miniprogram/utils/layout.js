/**
 * 手机 / 平板 / 电脑 布局参数
 * 宽屏（≥600px）启用居中限宽与更合理的顶栏留白
 */
function readWindow() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo();
  } catch (e) {
    /* fall through */
  }
  return wx.getSystemInfoSync();
}

function getLayout() {
  const info = readWindow();
  const windowWidth = Number(info.windowWidth) || 375;
  const windowHeight = Number(info.windowHeight) || 667;
  const isWide = windowWidth >= 600;
  const isTablet = windowWidth >= 600 && windowWidth < 960;
  const isPc = windowWidth >= 960;

  let statusBarHeight = Number(info.statusBarHeight) || 0;
  // 电脑微信常见 statusBarHeight=0，给一点顶栏呼吸感
  if (isWide && statusBarHeight < 12) statusBarHeight = 12;

  return {
    windowWidth,
    windowHeight,
    isWide,
    isTablet,
    isPc,
    statusBarHeight,
    heroPadTop: statusBarHeight + (isWide ? 52 : 72),
  };
}

module.exports = {
  getLayout,
};
