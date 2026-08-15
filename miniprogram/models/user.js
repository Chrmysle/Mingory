// users 集合最终字段。白名单可由已授权成员在成员管理页面维护。
const USER_FIELDS = Object.freeze([
  "_id",
  "openid",
  "name",
  "enabled",
  "createdAt",
  "updatedAt",
]);

module.exports = { USER_FIELDS };
