"use strict";

const _EVENTS = {
  onLeave: "onLeave",
  onJoin: "onJoin",
  onCreate: "onCreate",
  onStreamStarted: "onStreamStarted",
  onStreamEnded: "onStreamEnded",
  onReady: "onReady",
  onScreenShareStopped: "onScreenShareStopped",
  exitRoom: "exitRoom",
  onConnected: "onConnected",
  onRemoteTrack: "onRemoteTrack",
};

class LiderClient {
  constructor(options) {
    const defaultSettings = {
      port: 5001,
      configuration: {
        iceServers: [
          { urls: "stun:stun.stunprotocol.org:3478" },
          { urls: "stun:stun.l.google.com:19302" },
        ],
      },
    };

    this.roomId = null;
    this.settings = Object.assign({}, defaultSettings, options);
    this._isOpen = false;
    this.eventListeners = new Map();
    this.connection = null;
    this.consumers = new Map();
    this.clients = new Map();
    this.localPeer = null;
    this.localUUID = null;
    this.localStream = null;
    this.username = null;
    Object.keys(_EVENTS).forEach((event) => {
      this.eventListeners.set(event, []);
    });

    this.initWebSocket();
    this.trigger(_EVENTS.onReady);
  }

  initWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.hostname}:${this.settings.port}`;
    this.connection = new WebSocket(url);
    this.connection.onmessage = (data) => this.handleMessage(data);
    this.connection.onclose = () => this.handleClose();
    this.connection.onopen = (event) => {
      this.trigger(_EVENTS.onConnected, event);
      this._isOpen = true;
    };
  }

  on(event, callback) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).push(callback);
    }
  }

  trigger(event, args = null) {
    if (this.eventListeners.has(event)) {
      this.eventListeners
        .get(event)
        .forEach((callback) => callback.call(this, args));
    }
  }

  static get EVENTS() {
    return _EVENTS;
  }

  get IsOpen() {
    return _isOpen;
  }

  findUserVideo(username) {
    console.log(username);
    return document.querySelector(`#remote_${username}`);
  }

  async handleRemoteTrack(stream, username) {
    const userVideo = this.findUserVideo(username);
    if (userVideo) {
      userVideo.srcObject.addTrack(stream.getTracks()[0]);
    } else {
      const video = document.createElement("video");
      video.id = `remote_${username}`;
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = username == this.username;

      const div = document.createElement("div");
      div.id = `user_${username}`;
      div.classList.add("videoWrap");

      const nameContainer = document.createElement("div");
      nameContainer.classList.add("display_name");
      const textNode = document.createTextNode(username);
      nameContainer.appendChild(textNode);
      div.appendChild(nameContainer);
      div.appendChild(video);
      document.querySelector(".videos-inner").appendChild(div);

      this.trigger(_EVENTS.onRemoteTrack, stream);
    }

    this.recalculateLayout();
  }

  async handleIceCandidate({ candidate }) {
    if (candidate && candidate.candidate && candidate.candidate.length > 0) {
      const payload = {
        type: "ice",
        ice: candidate,
        uqid: this.localUUID,
        roomId: this.roomId,
      };
      this.connection.send(JSON.stringify(payload));
    }
  }

  handleConsumerIceCandidate(e, id, consumerId) {
    const { candidate } = e;
    if (candidate && candidate.candidate && candidate.candidate.length > 0) {
      const payload = {
        type: "consumer_ice",
        ice: candidate,
        uqid: id,
        consumerId,
        roomId: this.roomId,
      };
      this.connection.send(JSON.stringify(payload));
    }
  }

  handleConsume({ sdp, id, consumerId }) {
    const desc = new RTCSessionDescription(sdp);
    this.consumers
      .get(consumerId)
      .setRemoteDescription(desc)
      .catch((e) => console.log(e));
  }

  async createConsumeTransport(peer) {
    const consumerId = this.uuidv4();
    const consumerTransport = new RTCPeerConnection(
      this.settings.configuration
    );
    this.clients.get(peer.id).consumerId = consumerId;
    consumerTransport.id = consumerId;
    consumerTransport.peer = peer;
    this.consumers.set(consumerId, consumerTransport);
    this.consumers
      .get(consumerId)
      .addTransceiver("video", { direction: "recvonly" });
    this.consumers
      .get(consumerId)
      .addTransceiver("audio", { direction: "recvonly" });
    const offer = await this.consumers.get(consumerId).createOffer();
    await this.consumers.get(consumerId).setLocalDescription(offer);

    this.consumers.get(consumerId).onicecandidate = (e) =>
      this.handleConsumerIceCandidate(e, peer.id, consumerId);

    this.consumers.get(consumerId).ontrack = (e) => {
      this.handleRemoteTrack(e.streams[0], peer.username);
    };

    return consumerTransport;
  }

  async consumeOnce(peer) {
    const transport = await this.createConsumeTransport(peer);
    const payload = {
      type: "consume",
      id: peer.id,
      consumerId: transport.id,
      sdp: await transport.localDescription,
      roomId: this.roomId,
    };

    this.connection.send(JSON.stringify(payload));
  }

  async handlePeers({ peers }) {
    if (peers.length > 0) {
      for (const peer in peers) {
        this.clients.set(peers[peer].id, peers[peer]);
        await this.consumeOnce(peers[peer]);
      }
    }
  }

  handleAnswer({ sdp }) {
    const desc = new RTCSessionDescription(sdp);
    this.localPeer.setRemoteDescription(desc).catch((e) => console.log(e));
  }

  async handleNewProducer({ id, username }) {
    if (id === this.localUUID) return;

    this.clients.set(id, { id, username });

    await this.consumeOnce({ id, username });
  }

  handleMessage({ data }) {
    const message = JSON.parse(data);

    switch (message.type) {
      case "welcome":
        this.localUUID = message.id;
        break;
      case "answer":
        this.handleAnswer(message);
        break;
      case "peers":
        this.handlePeers(message);
        break;
      case "consume":
        this.handleConsume(message);
        break;
      case "newProducer":
        this.handleNewProducer(message);
        break;
      case "user_left":
        this.removeUser(message);
        break;
    }
  }

  removeUser({ id }) {
    const { username, consumerId } = this.clients.get(id);
    this.consumers.delete(consumerId);
    this.clients.delete(id);
    document
      .querySelector(`#remote_${username}`)
      .srcObject.getTracks()
      .forEach((track) => track.stop());
    document.querySelector(`#user_${username}`).remove();

    this.recalculateLayout();
  }

  initLayout() {
    const layout = document.getElementById("remote_videos");
    //add a div tag with class name videos-inner
    const videosInner = document.createElement("div");
    videosInner.classList.add("videos-inner");
    layout.appendChild(videosInner);

    //add a div tag with class name toolbox
    const toolbox = document.createElement("div");
    toolbox.classList.add("toolbox");
    layout.appendChild(toolbox);

    // add 4 buttons mic, video, screen share and end call
    const mic = document.createElement("button");
    mic.classList.add("mic");
    mic.innerHTML = "Mic";
    mic.addEventListener("click", () => this.toggleAudio());

    const video = document.createElement("button");
    video.classList.add("video");
    video.innerHTML = "Video";
    video.addEventListener("click", () => this.toggleVideo());

    const screenShare = document.createElement("button");
    screenShare.classList.add("screen-share");
    screenShare.innerHTML = "Screen Share";

    const endCall = document.createElement("button");
    endCall.classList.add("end-call");
    endCall.innerHTML = "End Call";
    endCall.addEventListener("click", () => window.close());

    toolbox.appendChild(mic);
    toolbox.appendChild(video);
    toolbox.appendChild(screenShare);
    toolbox.appendChild(endCall);
  }

  async connect({ roomId, username }) {
    //Produce media
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    this.initLayout();
    this.username = username;
    this.roomId = roomId;
    this.handleRemoteTrack(stream, this.username);
    this.localStream = stream;

    this.localPeer = this.createPeer();
    this.localStream
      .getTracks()
      .forEach((track) => this.localPeer.addTrack(track, this.localStream));
    await this.subscribe();
  }

  toggleAudio() {
    this.localStream.getAudioTracks()[0].enabled =
      !this.localStream.getAudioTracks()[0].enabled;
  }

  toggleVideo() {
    this.localStream.getVideoTracks()[0].enabled =
      !this.localStream.getVideoTracks()[0].enabled;
  }

  createPeer() {
    this.localPeer = new RTCPeerConnection(this.configuration);
    this.localPeer.onicecandidate = (e) => this.handleIceCandidate(e);
    //peer.oniceconnectionstatechange = checkPeerConnection;
    this.localPeer.onnegotiationneeded = () => this.handleNegotiation();
    return this.localPeer;
  }

  async subscribe() {
    // Consume media
    await this.consumeAll();
  }

  async consumeAll() {
    const payload = {
      type: "getPeers",
      uqid: this.localUUID,
      roomId: this.roomId,
    };

    this.connection.send(JSON.stringify(payload));
  }

  async handleNegotiation(peer, type) {
    console.log("*** negoitating ***");
    const offer = await this.localPeer.createOffer();
    await this.localPeer.setLocalDescription(offer);

    this.connection.send(
      JSON.stringify({
        type: "connect",
        sdp: this.localPeer.localDescription,
        uqid: this.localUUID,
        username: this.username,
        roomId: this.roomId,
      })
    );
  }

  handleClose() {
    this.connection = null;
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
    }
    this.clients = null;
    this.consumers = null;
  }

  uuidv4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        var r = (Math.random() * 16) | 0,
          v = c == "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  }

  recalculateLayout() {
    const container = remoteContainer;
    const videoContainer = document.querySelector(".videos-inner");
    const videoCount = container.querySelectorAll(".videoWrap").length;

    if (videoCount >= 3) {
      videoContainer.style.setProperty("--grow", 0 + "");
    } else {
      videoContainer.style.setProperty("--grow", 1 + "");
    }
  }
}
