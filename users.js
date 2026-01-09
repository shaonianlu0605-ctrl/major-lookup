// 用户账号密码数据
// 账号格式：11位数字
// 密码格式：数字+字母大小写组合
const USERS = {
  // 示例用户（请替换为实际用户）
  "13800138000": "Pass123abc",
  "13900139000": "Test456XYZ",
  "17721663402": "lydtjy3402",
  "18994772558": "lydtjy2558",
  "17301529855": "lydtjy9855",
  "15295128531": "jtdtjy8531",
  "13813511082": "jtdtjy1082",
  "18151243004": "czdtjy3004"
};

// 导出用户数据
if (typeof module !== 'undefined' && module.exports) {
  module.exports = USERS;
}

