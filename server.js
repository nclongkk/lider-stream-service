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

app.use(express.static("public"));
app.get("/simple-sfu-client.js", (req, res) => {
  res.sendFile(__dirname + "/public/SimpleSFUClient.js");
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
let rooms = new Map();

function handleTrackEvent(body, e, peer, ws) {
  if (e.streams && e.streams[0]) {
    peers.get(peer).stream = e.streams[0];

    const payload = {
      type: "newProducer",
      id: peer,
      username: peers.get(peer).username,
      roomId: body.roomId,
    };
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
    peers.delete(ws.id);
    consumers.delete(ws.id);

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
      case "connect":
        const existedRoom = rooms.get(body.roomId);
        if (!existedRoom) {
          const newSet = new Set();
          newSet.add(body.uqid);
          rooms.set(body.roomId, { peers: newSet });
        } else {
          existedRoom.peers.add(body.uqid);
        }

        peers.set(body.uqid, { socket: ws });
        console.log(peers.get(body.uqid));
        const peer = createPeer();
        peers.get(body.uqid).username = body.username;
        peers.get(body.uqid).peer = peer;
        peer.ontrack = (e) => {
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
      case "getPeers":
        let uuid = body.uqid;
        const list = [];
        const room = rooms.get(body.roomId);
        if (room) {
          const listPeers = room.peers;
          listPeers.forEach((peer) => {
            if (peer != uuid) {
              const peerInfo = {
                id: peer,
                username: peers.get(peer).username,
              };
              list.push(peerInfo);
            }
          });
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
        };

        ws.send(JSON.stringify(peersPayload));
        break;
      case "ice":
        const user = peers.get(body.uqid);
        if (user.peer)
          user.peer
            .addIceCandidate(new webrtc.RTCIceCandidate(body.ice))
            .catch((e) => console.log(e));
        break;
      case "consume":
        try {
          let { id, sdp, consumerId } = body;
          const remoteUser = peers.get(id);
          const newPeer = createPeer();
          consumers.set(consumerId, newPeer);
          const _desc = new webrtc.RTCSessionDescription(sdp);
          await consumers.get(consumerId).setRemoteDescription(_desc);

          remoteUser.stream.getTracks().forEach((track) => {
            consumers.get(consumerId).addTrack(track, remoteUser.stream);
          });
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
      case "consumer_ice":
        if (consumers.has(body.consumerId)) {
          consumers
            .get(body.consumerId)
            .addIceCandidate(new webrtc.RTCIceCandidate(body.ice))
            .catch((e) => console.log(e));
        }
        break;
      default:
        wss.broadcast(body.roomId, message);
    }
  });

  ws.on("error", () => ws.terminate());
});

wss.broadcast = function (roomId, data) {
  console.log("broadcasting", roomId);
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
