const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

exports.verifyToken = async ({ token, webUrl, roomId }) => {
  try {
    const url = process.env.LIDER_APP_API + "/api/app/users-public";
    const { data } = await axios.post(
      url,
      { token, webUrl, customRoomId: roomId },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    return data;
  } catch (error) {
    throw error;
  }
};

exports.startMeeting = async ({
  roomId,
  customRoomId,
  appId,
  createdBy,
  accessType,
}) => {
  try {
    const url =
      process.env.LIDER_APP_API + "/api/app/users-public/start-meeting";
    const { data } = await axios.post(
      url,
      {
        roomId,
        customRoomId,
        appId,
        createdBy,
        accessType,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    return data;
  } catch (error) {
    console.log(error);
  }
};

exports.newUserJoin = async ({ roomId, user }) => {
  try {
    console.log("user", user), roomId;
    const url =
      process.env.LIDER_APP_API + `/api/app/users-public/${roomId}/new-user`;
    const { data } = await axios.post(url, user, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    return data;
  } catch (error) {}
};

exports.userLeft = async ({ roomId, userId }) => {
  try {
    const url =
      process.env.LIDER_APP_API + `/api/app/users-public/${roomId}/user-left`;
    const { data } = await axios.post(
      url,
      { userId },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    return data;
  } catch (error) {
    throw error;
  }
};

exports.endMeeting = async ({ roomId }) => {
  try {
    const url =
      process.env.LIDER_APP_API + `/api/app/users-public/${roomId}/end-meeting`;
    const { data } = await axios.post(
      url,
      { roomId },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    return data;
  } catch (error) {
    throw error;
  }
};
