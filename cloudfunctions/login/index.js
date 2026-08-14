const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function fail(code, message, data) {
  return {
    success: false,
    code,
    message,
    ...(data ? { data } : {}),
  };
}

exports.main = async () => {
  const { OPENID: openid } = cloud.getWXContext();

  if (!openid) {
    return fail("UNAUTHORIZED", "无法识别当前微信用户");
  }

  try {
    const { data: users } = await db
      .collection("users")
      .where({ openid })
      .limit(2)
      .get();

    if (users.length === 0) {
      return fail("UNAUTHORIZED", "当前微信用户不在系统白名单中", { openid });
    }

    if (users.length > 1) {
      console.error("Duplicate users found for openid", openid);
      return fail("DATABASE_ERROR", "用户身份配置重复，请联系管理员");
    }

    const user = users[0];
    if (user.enabled !== true) {
      return fail("UNAUTHORIZED", "当前账号已停用", { openid });
    }

    return {
      success: true,
      data: {
        _id: user._id,
        openid: user.openid,
        name: user.name,
      },
      message: "登录成功",
    };
  } catch (error) {
    console.error("login failed", error);
    return fail("DATABASE_ERROR", "用户身份验证失败，请检查 users 集合配置");
  }
};
