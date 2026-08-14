// users 集合最终字段。白名单记录由管理员在云数据库控制台维护。
const USER_FIELDS = Object.freeze([
  "_id",
  "openid",
  "name",
  "enabled",
  "createdAt",
  "updatedAt",
]);

module.exports = { USER_FIELDS };
