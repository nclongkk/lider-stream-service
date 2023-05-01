"use strict";

const webrtc = require("wrtc");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const http = require("http");
const https = require("https");
const WebSocket = require("ws");
const express = require("express");
const app = express();
const _ = require("lodash");

app.use(express.static("public"));
app.get("/simple-sfu-client.js", (req, res) => {
  res.sendFile(__dirname + "/public/SimpleSFUClient.js");
});

app.get("/meet", (req, res) => {
  console.log("meet");
  res.sendFile(__dirname + "/public/meet.html");
});

app.get("/style.css", (req, res) => {
  res.sendFile(__dirname + "/public/style.css");
});

app.get("/iframe", (req, res) => {
  res.sendFile(__dirname + "/public/iframe.html");
});
// based on examples at https://www.npmjs.com/package/ws
const WebSocketServer = WebSocket.Server;

let serverOptions = {
  listenPort: 5001,
  useHttps: true,
  httpsCertFile: "/Users/nclongkk/BossProject/Lider/web-rtc-server/cert.pem",
  httpsKeyFile: "/Users/nclongkk/BossProject/Lider/web-rtc-server/key.pem",
};

let sslOptions = {};
if (serverOptions.useHttps) {
  sslOptions.key = fs.readFileSync(serverOptions.httpsKeyFile).toString();
  sslOptions.cert = fs.readFileSync(serverOptions.httpsCertFile).toString();
}

let webServer = null;
if (serverOptions.useHttps) {
  webServer = https.createServer(sslOptions, app);
  webServer.listen(serverOptions.listenPort);
} else {
  webServer = http.createServer(app);
  webServer.listen(serverOptions.listenPort);
}
let peers = new Map();
let consumers = new Map();
let consumersScreenShare = new Map();
let rooms = new Map();

function handleTrackEvent(body, e, peer, ws) {
  if (e.streams && e.streams[0]) {
    peers.get(peer).stream = e.streams[0];
    const user = rooms.get(body.roomId).clients[peer];
    console.log("handleTrackEvent", user);

    const payload = {
      type: "newProducer",
      id: peer,
      username: peers.get(peer).username,
      user,
      roomId: body.roomId,
    };
    wss.broadcast(body.roomId, JSON.stringify(payload));
  }
}

function handleTrackEventScreenShare(body, e, roomId, ws) {
  if (e.streams && e.streams[0]) {
    const room = rooms.get(roomId);
    room.screenShare.stream = e.streams[0];

    const payload = {
      type: "newProducer-screen-share",
      roomId: body.roomId,
      userId: room.screenShare.userId,
      username: room.screenShare.username,
    };
    console.log("handleTrackEventScreenShare", payload);
    wss.broadcast(body.roomId, JSON.stringify(payload));
  }
}

function createPeer() {
  let peer = new webrtc.RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.stunprotocol.org:3478" },
      { urls: "stun:stun.l.google.com:19302" },
    ],
  });

  return peer;
}

function setBandwidthAudio(sdp, bandwidth) {
  sdp = sdp.replace(
    /a=mid:audio\r\n/g,
    "a=mid:audio\r\nb=AS:" + audioBandwidth + "\r\n"
  );
  return sdp;
}

function setBandwidthVideo(sdp, bandwidth) {
  sdp = sdp.replace(
    /a=mid:video\r\n/g,
    "a=mid:video\r\nb=AS:" + videoBandwidth + "\r\n"
  );
  return sdp;
}

// Create a server for handling websocket calls
const wss = new WebSocketServer({ server: webServer });

wss.on("connection", function (ws) {
  let peerId = uuidv4();
  ws.id = peerId;
  ws.on("close", (event) => {
    console.log("close room", ws.roomId);
    if (!ws.roomId) return;
    rooms.get(ws.roomId).peers.delete(ws.id);
    rooms.get(ws.roomId).clients[ws.id] = {
      ...rooms.get(ws.roomId).clients[ws.id],
      id: ws.id,
      disconnectedAt: new Date(),
    };
    console.log("rooms", rooms.get(ws.roomId).clients);
    peers.delete(ws.id);
    const room = rooms.get(ws.roomId);
    if (room.consumerOfUser && room.consumerOfUser.get(ws.id)) {
      room.consumerOfUser.get(ws.id).forEach((consumer) => {
        consumers.delete(consumer);
      });
      room.consumerOfUser.delete(ws.id);
    }

    wss.broadcast(
      ws.roomId,
      JSON.stringify({
        type: "user_left",
        id: ws.id,
      })
    );
  });

  ws.send(JSON.stringify({ type: "welcome", id: peerId }));
  ws.on("message", async function (message) {
    const body = JSON.parse(message);
    ws.roomId = body.roomId;
    // console.log(peers);
    switch (body.type) {
      case "connect": {
        console.log("connect");
        const existedRoom = rooms.get(body.roomId);
        if (!existedRoom) {
          const newSet = new Set();
          newSet.add(body.uqid);
          rooms.set(body.roomId, { peers: newSet });
        } else {
          existedRoom.peers.add(body.uqid);
        }

        _.set(rooms.get(body.roomId), `clients.${body.uqid}`, {
          ...body.user,
          id: body.uqid,
          connectedAt: new Date(),
        });
        console.log(rooms.get(body.roomId).clients);
        peers.set(body.uqid, { socket: ws });
        const peer = createPeer();
        peers.get(body.uqid).user = body.user;
        peers.get(body.uqid).username = body.username;
        peers.get(body.uqid).peer = peer;
        peer.ontrack = (e) => {
          console.log("ontrack");
          handleTrackEvent(body, e, body.uqid, ws);
        };
        const desc = new webrtc.RTCSessionDescription(body.sdp);
        await peer.setRemoteDescription(desc);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        const payload = {
          type: "answer",
          sdp: peer.localDescription,
        };

        ws.send(JSON.stringify(payload));
        break;
      }

      case "connect-screen-share": {
        console.log("connect-screen-share");

        const existedRoomScreenShare = rooms.get(body.roomId);
        if (!existedRoomScreenShare) {
          return;
        }

        const peerScreenShare = createPeer();
        existedRoomScreenShare.screenShare = {
          userId: body.uqid,
          username: body.username,
          peer: peerScreenShare,
          ws: ws,
        };
        peerScreenShare.ontrack = (e) => {
          console.log("ontrack-screen-share");
          handleTrackEventScreenShare(body, e, body.roomId, ws);
        };
        const descScreenShare = new webrtc.RTCSessionDescription(body.sdp);
        await peerScreenShare.setRemoteDescription(descScreenShare);
        const answerScreenShare = await peerScreenShare.createAnswer();
        await peerScreenShare.setLocalDescription(answerScreenShare);

        const payloadScreenShare = {
          type: "answer-screen-share",
          sdp: peerScreenShare.localDescription,
        };

        ws.send(JSON.stringify(payloadScreenShare));
        break;
      }

      case "getPeers": {
        let uuid = body.uqid;
        const list = [];
        let userSharingScreen;
        const room = rooms.get(body.roomId);
        if (room) {
          const listPeers = room.peers;
          listPeers.forEach((peer) => {
            if (peer != uuid) {
              const peerInfo = {
                id: peer,
                user: peers.get(peer).user,
              };
              list.push(peerInfo);
            }
          });
          if (room.screenShare) {
            userSharingScreen = {
              userId: room.screenShare.userId,
              username: room.screenShare.username,
            };
          }
        }
        // peers.forEach((peer, key) => {
        //   if (key != uuid) {
        //     const peerInfo = {
        //       id: key,
        //       username: peer.username,
        //     };
        //     list.push(peerInfo);
        //   }
        // });

        const peersPayload = {
          type: "peers",
          peers: list,
          userSharingScreen,
        };

        ws.send(JSON.stringify(peersPayload));
        break;
      }
      case "ice": {
        console.log("ice");
        const user = peers.get(body.uqid);
        if (user.peer)
          user.peer
            .addIceCandidate(new webrtc.RTCIceCandidate(body.ice))
            .catch((e) => console.log(e));
        break;
      }

      case "ice-screen-share": {
        // const user = peers.get(body.uqid);
        // if (user.peer)
        //   user.peer
        //     .addIceCandidate(new webrtc.RTCIceCandidate(body.ice))
        //     .catch((e) => console.log(e));
        console.log("ice-screen-share", body);
        const room = rooms.get(body.roomId);
        if (room && room.screenShare && room.screenShare.userId === body.uqid) {
          room.screenShare.peer
            .addIceCandidate(new webrtc.RTCIceCandidate(body.ice))
            .catch((e) => console.log(e));
        }
        break;
      }

      case "consume": {
        try {
          let { id, sdp, consumerId, roomId } = body;
          const remoteUser = peers.get(id);
          const newPeer = createPeer();
          consumers.set(consumerId, newPeer);

          const room = rooms.get(roomId);
          if (!room.consumerOfUser) {
            room.consumerOfUser = new Map();
          }
          if (!room.consumerOfUser.get(id)) {
            room.consumerOfUser.set(id, new Set());
          }
          room.consumerOfUser.get(id).add(consumerId);
          console.log(room.consumerOfUser);

          const _desc = new webrtc.RTCSessionDescription(sdp);
          await consumers.get(consumerId).setRemoteDescription(_desc);

          remoteUser.stream.getTracks().forEach((track) => {
            consumers.get(consumerId).addTrack(track, remoteUser.stream);
          });

          const remoteUserData = _.get(rooms.get(roomId));
          const _answer = await consumers
            .get(consumerId)
            .createAnswer(function (desc) {
              desc.sdp = setBandwidthAudio(desc.sdp, 50);
              desc.sdp = setBandwidthVideo(desc.sdp, 256);
              console.log("answer", desc.sdp);
              return desc;
            });
          await consumers.get(consumerId).setLocalDescription(_answer);

          const _payload = {
            type: "consume",
            sdp: consumers.get(consumerId).localDescription,
            username: remoteUser.username,
            id,
            consumerId,
          };

          ws.send(JSON.stringify(_payload));
        } catch (error) {
          console.log(error);
        }

        break;
      }

      case "consume-screen-share": {
        try {
          let { id, sdp, consumerId, roomId } = body;
          const room = rooms.get(roomId);
          const newPeer = createPeer();
          consumersScreenShare.set(consumerId, newPeer);
          const _desc = new webrtc.RTCSessionDescription(sdp);
          await consumersScreenShare
            .get(consumerId)
            .setRemoteDescription(_desc);

          room.screenShare.stream.getTracks().forEach((track) => {
            consumersScreenShare
              .get(consumerId)
              .addTrack(track, room.screenShare.stream);
          });
          if (!room.screenShare.consumerOfScreenShare) {
            room.screenShare.consumerOfScreenShare = new Set();
          }
          room.screenShare.consumerOfScreenShare.add(consumerId);

          const _answer = await consumersScreenShare
            .get(consumerId)
            .createAnswer(function (desc) {
              desc.sdp = setBandwidthAudio(desc.sdp, 50);
              desc.sdp = setBandwidthVideo(desc.sdp, 50);
              console.log("answer", desc.sdp);
              return desc;
            });
          await consumersScreenShare
            .get(consumerId)
            .setLocalDescription(_answer);

          console.log("consume-screen-share");
          const _payload = {
            type: "consume-screen-share",
            sdp: consumersScreenShare.get(consumerId).localDescription,
            id,
            consumerId,
          };

          ws.send(JSON.stringify(_payload));
        } catch (error) {
          console.log(error);
        }

        break;
      }
      case "consumer_ice": {
        if (consumers.has(body.consumerId)) {
          consumers
            .get(body.consumerId)
            .addIceCandidate(new webrtc.RTCIceCandidate(body.ice))
            .catch((e) => console.log(e));
        }
        break;
      }

      case "consumer_ice_screen_share": {
        if (consumersScreenShare.has(body.consumerId)) {
          consumersScreenShare
            .get(body.consumerId)
            .addIceCandidate(new webrtc.RTCIceCandidate(body.ice))
            .catch((e) => console.log(e));
        }
        break;
      }

      case "stop_screen_share": {
        const room = rooms.get(body.roomId);
        if (room && room.screenShare && room.screenShare.userId === body.uqid) {
          room.screenShare.stream.getTracks().forEach((track) => {
            track.stop();
          });

          room.screenShare.consumerOfScreenShare.forEach((consumerId) => {
            consumersScreenShare.get(consumerId).close();
            consumersScreenShare.delete(consumerId);
          });
          const payload = {
            type: "user_stop_screen_share",
            uqid: room.screenShare.uqid,
            username: room.screenShare.username,
          };
          room.screenShare = null;

          wss.broadcast(body.roomId, JSON.stringify(payload));
        }
        break;
      }
      default:
        wss.broadcast(body.roomId, message);
    }
  });

  ws.on("error", () => ws.terminate());
});

wss.broadcast = function (roomId, data) {
  console.log("broadcasting", roomId, data);
  const room = rooms.get(roomId);
  !!room &&
    room.peers.forEach((peerId) => {
      const peer = peers.get(peerId);
      if (!!peer && peer.socket.readyState === WebSocket.OPEN) {
        peer.socket.send(data);
      }
    });
};

console.log("Server running.");
