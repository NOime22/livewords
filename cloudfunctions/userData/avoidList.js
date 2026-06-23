function getAvoidStatuses() {
  // 全局避开：避免“已出现过的词”再次被当作新词抽中
  return ["unknown", "learning", "known", "mastered", "banned"];
}

module.exports = {
  getAvoidStatuses,
};
