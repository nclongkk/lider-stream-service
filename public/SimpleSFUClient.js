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
  constructor(container) {
    const defaultSettings = {
      port: 5001,
      configuration: {
        iceServers: [
          { urls: "stun:stun.stunprotocol.org:3478" },
          { urls: "stun:stun.l.google.com:19302" },
        ],
      },
    };

    this.liderView = null;
    this.liderContainer = container;
    this.roomId = null;
    this.settings = Object.assign({}, defaultSettings);
    this._isOpen = false;
    this.eventListeners = new Map();
    this.connection = null;
    this.consumers = new Map();
    this.clients = new Map();
    this.localPeer = null;
    this.localUUID = null;
    this.localStream = null;
    this.username = null;
    this.user = null;
    this.localShareScreenStream = null;
    this.consumerScreenShare = null;

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

  async handleRemoteTrack(stream, user, from) {
    console.log("handleRemoteTrack", user, from);
    if (!user.username) {
      console.log("not enough data ", user);
    }
    const username = user.username || user;
    this.liderView?.addOneCamera(user, stream);
    // const userVideo = this.findUserVideo(username);
    // if (userVideo) {
    //   userVideo.srcObject.addTrack(stream.getTracks()[0]);
    // } else {
    //   const video = document.createElement("video");
    //   video.id = `remote_${username}`;
    //   video.srcObject = stream;
    //   video.autoplay = true;
    //   video.muted = username == this.username;

    //   const div = document.createElement("div");
    //   div.id = `user_${username}`;
    //   div.classList.add("videoWrap");

    //   const nameContainer = document.createElement("div");
    //   nameContainer.classList.add("display_name");
    //   const textNode = document.createTextNode(username);
    //   nameContainer.appendChild(textNode);
    //   div.appendChild(nameContainer);
    //   div.appendChild(video);
    //   document.querySelector(".videos-inner").appendChild(div);

    //   this.trigger(_EVENTS.onRemoteTrack, stream);
    // }

    // this.recalculateLayout();
  }

  async handleIceCandidate({ candidate }) {
    console.log("handleIceCandidate");
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

  async createConsumeTransport(peer, from) {
    console.log("createConsumeTransport", peer, from);
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
      this.handleRemoteTrack(e.streams[0], peer, "create consume transport");
    };

    return consumerTransport;
  }

  async consumeOnce(peer, from) {
    console.log("consumeOnce", peer, from);
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

  async handlePeers({ userSharingScreen, peers }) {
    console.log("handlePeers", peers);
    if (userSharingScreen) {
      this.consumeScreenShare(userSharingScreen);
    }
    if (peers.length > 0) {
      for (const peer in peers) {
        this.clients.set(peers[peer].id, peers[peer]);
        await this.consumeOnce(peers[peer].user, "handle peers");
      }
    }
  }

  handleAnswer({ sdp }) {
    console.log(sdp);
    const desc = new RTCSessionDescription(sdp);
    this.localPeer.setRemoteDescription(desc).catch((e) => console.log(e));
  }

  async handleNewProducer({ id, user }) {
    console.log("handleNewProducer", id, user, this.localUUID);
    if (id === this.localUUID) return;

    this.clients.set(id, user);

    await this.consumeOnce(user, "handleNewProducer");
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

      case "answer-screen-share":
        this.handleScreenShareAnswer(message);
        break;

      case "newProducer-screen-share":
        this.consumeScreenShare(message);
        break;

      case "consume-screen-share":
        this.handleConsumeScreenShare(message);
        break;

      case "user_stop_screen_share":
        console.log("user_stop_screen_share");
        this.consumerScreenShare = null;
        break;
    }
  }

  removeUser({ id }) {
    const { username, consumerId } = this.clients.get(id);
    this.consumers.delete(consumerId);
    this.clients.delete(id);
    // document
    //   .querySelector(`#remote_${username}`)
    //   .srcObject.getTracks()
    //   .forEach((track) => track.stop());
    // document.querySelector(`#user_${username}`).remove();
    this.liderView?.deleteCamera(id);
  }

  initLayout(liderContainer) {
    const layout = liderContainer;
    console.log(layout);
    //set layout size
    layout.style.width = "1500px";
    layout.style.height = "900px";
    //insert an ifram into layout
    const iframe = document.createElement("iframe");
    iframe.id = "lider-iframe";
    iframe.src = "https://localhost:5001/meet";
    console.log(iframe);
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    layout?.appendChild(iframe);

    iframe.onload = () => {
      let scenary =
        iframe.contentWindow.document.getElementById("lider-videos");
      this.liderView = new LiderView(scenary);
      this.liderView.append();
      this.liderView.resize();

      window.addEventListener("resize", () => {
        this.liderView.resize();
      });
    };
    // const divLiderMeetingArea = document.createElement("div");
    // divLiderMeetingArea.id = "lider-meeting-area";
    // layout?.appendChild(divLiderMeetingArea);

    // const liderVideoArea = document.createElement("div");
    // liderVideoArea.id = "remote_videos";
    // divLiderMeetingArea.appendChild(liderVideoArea);

    // const liderToolbox = document.createElement("div");
    // liderToolbox.id = "lider-toolbox";
    // divLiderMeetingArea.appendChild(liderToolbox);

    // // liderToolbox inclule div liderToolboxLeft, liderToolboxCenter and liderToolboxRight, liderToolboxLeft include 2 buttons audio and video, liderToolboxCenter include 1 button hangup, liderToolboxRight include 1 button screen share, 3 div liderToolboxLeft, liderToolboxCenter and liderToolboxRight has the same class lider-toolbox-button-container
    // const liderToolboxLeft = document.createElement("div");
    // liderToolboxLeft.classList.add("lider-toolbox-button-container");
    // liderToolboxLeft.id = "lider-toolbox-left";
    // liderToolbox.appendChild(liderToolboxLeft);

    // const liderToolboxCenter = document.createElement("div");
    // liderToolboxCenter.classList.add("lider-toolbox-button-container");
    // liderToolboxCenter.id = "lider-toolbox-center";
    // liderToolbox.appendChild(liderToolboxCenter);

    // const liderToolboxRight = document.createElement("div");
    // liderToolboxRight.classList.add("lider-toolbox-button-container");
    // liderToolboxRight.id = "lider-toolbox-right";
    // liderToolbox.appendChild(liderToolboxRight);

    // const audio = document.createElement("button");
    // audio.classList.add("lider-toolbox-button");
    // audio.id = "lider-toogle-audio";
    // audio.innerHTML = "Audio";
    // audio.addEventListener("click", () => this.toggleAudio());

    // const video = document.createElement("button");
    // video.classList.add("lider-toolbox-button");
    // video.id = "lider-toogle-video";
    // video.innerHTML = "Video";
    // video.addEventListener("click", () => this.toggleVideo());

    // const hangup = document.createElement("button");
    // hangup.classList.add("lider-toolbox-button");
    // hangup.id = "lider-hangup";
    // hangup.innerHTML = "Hangup";
    // hangup.addEventListener("click", () => this.hangup());

    // const screenShare = document.createElement("button");
    // screenShare.classList.add("lider-toolbox-button");
    // screenShare.id = "lider-share-screen";
    // screenShare.innerHTML = "Screen Share";
    // screenShare.addEventListener("click", () => this.shareScreen());

    // liderToolboxLeft.appendChild(audio);
    // liderToolboxLeft.appendChild(video);
    // liderToolboxCenter.appendChild(hangup);
    // liderToolboxRight.appendChild(screenShare);

    //--------------------------------------------------------------------------------
    // const layout = document.getElementById("remote_videos");
    // //add a div tag with class name videos-inner
    // const videosInner = document.createElement("div");
    // videosInner.classList.add("videos-inner");
    // layout.appendChild(videosInner);

    // //add a div tag with class name toolbox
    // const toolbox = document.createElement("div");
    // toolbox.classList.add("toolbox");
    // layout.appendChild(toolbox);

    // // add 4 buttons mic, video, screen share and end call
    // const mic = document.createElement("button");
    // mic.classList.add("mic");
    // mic.innerHTML = "Mic";
    // mic.addEventListener("click", () => this.toggleAudio());

    // const video = document.createElement("button");
    // video.classList.add("video");
    // video.innerHTML = "Video";
    // video.addEventListener("click", () => this.toggleVideo());

    // const screenShare = document.createElement("button");
    // screenShare.classList.add("screen-share");
    // screenShare.innerHTML = "Screen Share";
    // screenShare.addEventListener("click", () => this.shareScreen());

    // const endCall = document.createElement("button");
    // endCall.classList.add("end-call");
    // endCall.innerHTML = "End Call";
    // endCall.addEventListener("click", () => window.close());

    // toolbox.appendChild(mic);
    // toolbox.appendChild(video);
    // toolbox.appendChild(screenShare);
    // toolbox.appendChild(endCall);
  }

  async connect({ roomId, user }) {
    //Produce media
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    if (!user.video) {
      stream.getVideoTracks()[0].enabled = false;
    }

    if (!user.audio) {
      stream.getAudioTracks()[0].enabled = false;
    }
    const layout = this.liderContainer;
    //set layout size
    layout.style.width = "100%";
    layout.style.height = "900px";
    //insert an ifram into layout
    const iframe = document.createElement("iframe");
    iframe.id = "lider-iframe";
    iframe.src = "https://localhost:5001/meet";
    console.log(iframe);
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    // attach the iframe to the layout
    layout?.appendChild(iframe);

    iframe.onload = () => {
      let scenary =
        iframe.contentWindow.document.getElementById("lider-videos");
      this.liderView = new LiderView(scenary);
      this.liderView.append();
      this.liderView.resize();

      window.addEventListener("resize", () => {
        this.liderView.resize();
      });

      setTimeout(() => {
        iframe.contentWindow.document
          .getElementById("lider-toggle-video")
          .addEventListener("click", () => this.toggleVideo());
        iframe.contentWindow.document
          .getElementById("lider-toogle-audio")
          .addEventListener("click", () => this.toggleAudio());
      }, 500);

      user.id = this.localUUID;
      this.user = user;
      this.username = user.username;
      this.roomId = roomId;
      this.handleRemoteTrack(stream, this.user, "user connect");
      this.localStream = stream;

      this.localPeer = this.createPeer();
      this.localStream
        .getTracks()
        .forEach((track) => this.localPeer.addTrack(track, this.localStream));
      this.subscribe();
    };
  }

  toggleAudio() {
    this.localStream.getAudioTracks()[0].enabled = !this.localStream.getAud;
    ioTracks()[0].enabled;
  }

  enableVideo() {
    const iframe = document.getElementById("lider-iframe");
    const videoIcon =
      iframe.contentWindow.document.getElementById("lider-video-icon");
    if (
      this.user.video &&
      videoIcon.classList.value.includes("fa-video-slash")
    ) {
      videoIcon.classList.toggle("fa-video");
      videoIcon.classList.toggle("fa-video-slash");
      this.localStream.getVideoTracks()[0].enabled = true;
    }

    const camera = iframe.contentWindow.document.getElementById(this.localUUID);
    // get the video element
    const video = camera.getElementsByTagName("video")[0];
    video.style.visibility = "visible";
  }

  disableVideo() {
    const iframe = document.getElementById("lider-iframe");
    const videoIcon =
      iframe.contentWindow.document.getElementById("lider-video-icon");
    if (
      !this.user.video &&
      !videoIcon.classList.value.includes("fa-video-slash")
    ) {
      videoIcon.classList.toggle("fa-video-slash");
      videoIcon.classList.toggle("fa-video");
      this.localStream.getVideoTracks()[0].enabled = false;
    }

    const camera = iframe.contentWindow.document.getElementById(this.localUUID);
    const video = camera.getElementsByTagName("video")[0];
    video.style.visibility = "hidden";
  }

  toggleVideo() {
    this.user.video = !this.user.video;
    if (this.user.video) {
      this.enableVideo();
    } else {
      this.disableVideo();
    }
    // this.localStream.getVideoTracks()[0].enabled =
    //   !this.localStream.getVideoTracks()[0].enabled;
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
        user: this.user,
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

  // Script for screen sharing
  async shareScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    stream.getVideoTracks()[0].onended = () => this.stopScreenShare();
    this.handleRemoteTrack(stream, "Screen Share");
    this.screenShareStream = stream;

    this.screenSharePeer = this.createShareScreenPeer();
    this.screenShareStream
      .getTracks()
      .forEach((track) =>
        this.screenSharePeer.addTrack(track, this.screenShareStream)
      );
  }

  createShareScreenPeer() {
    this.localShareScreenStream = new RTCPeerConnection(this.configuration);
    this.localShareScreenStream.onicecandidate = (e) =>
      this.handleIceCandidateForScreenShare(e);

    this.localShareScreenStream.onnegotiationneeded = () =>
      this.handleNegotiationForScreenShare();
    return this.localShareScreenStream;
  }

  async handleIceCandidateForScreenShare({ candidate }) {
    console.log("*** handleIceCandidateForScreenShare ***");
    if (candidate && candidate.candidate && candidate.candidate.length > 0) {
      const payload = {
        type: "ice-screen-share",
        ice: candidate,
        uqid: this.localUUID,
        roomId: this.roomId,
      };
      this.connection.send(JSON.stringify(payload));
    }
  }

  async handleNegotiationForScreenShare(peer, type) {
    console.log("*** negoitating share screen ***");
    const offer = await this.localShareScreenStream.createOffer();
    await this.localShareScreenStream.setLocalDescription(offer);
    this.connection.send(
      JSON.stringify({
        type: "connect-screen-share",
        sdp: this.localShareScreenStream.localDescription,
        uqid: this.localUUID,
        username: this.username,
        roomId: this.roomId,
      })
    );
  }

  async handleScreenShareAnswer({ sdp }) {
    console.log(sdp);
    const desc = new RTCSessionDescription(sdp);
    await this.localShareScreenStream
      .setRemoteDescription(desc)
      .catch((e) => console.log(e));
  }

  async consumeScreenShare(message) {
    if (message.userId === this.localUUID) return;

    const consumerScreenShareId = this.uuidv4();
    this.consumerScreenShare = new RTCPeerConnection(
      this.settings.configuration
    );
    this.consumerScreenShare.id = consumerScreenShareId;
    this.consumerScreenShare.addTransceiver("video", {
      direction: "recvonly",
    });
    this.consumerScreenShare.addTransceiver("audio", {
      direction: "recvonly",
    });
    const offer = await this.consumerScreenShare.createOffer();
    await this.consumerScreenShare.setLocalDescription(offer);

    this.consumerScreenShare.onicecandidate = (e) =>
      this.handleIceCandidateForScreenShareConsumer(e, consumerScreenShareId);

    this.consumerScreenShare.ontrack = (e) =>
      this.handleRemoteTrack(e.streams[0], `${message.username} is sharing`);
    this.connection.send(
      JSON.stringify({
        type: "consume-screen-share",
        sdp: this.consumerScreenShare.localDescription,
        uqid: this.localUUID,
        roomId: this.roomId,
        consumerId: consumerScreenShareId,
      })
    );
  }

  handleIceCandidateForScreenShareConsumer(e, consumerId) {
    const { candidate } = e;
    if (candidate && candidate.candidate && candidate.candidate.length > 0) {
      const payload = {
        type: "consumer_ice_screen_share",
        ice: candidate,
        uqid: this.localUUID,
        consumerId,
        roomId: this.roomId,
      };
      this.connection.send(JSON.stringify(payload));
    }
  }

  handleConsumeScreenShare({ sdp, id, consumerId }) {
    const desc = new RTCSessionDescription(sdp);
    this.consumerScreenShare
      .setRemoteDescription(desc)
      .catch((e) => console.log(e));
  }

  stopScreenShare() {
    if (!this.localShareScreenStream) return;

    this.localShareScreenStream = null;

    this.connection.send(
      JSON.stringify({
        type: "stop_screen_share",
        uqid: this.localUUID,
        roomId: this.roomId,
      })
    );
  }
}

class LiderView {
  // ratios
  _ratios = ["16:9", "4:3", "16:9", "1:1", "1:2"];

  // default options
  _dish = false;
  _conference = false;
  _cameras = 0;
  _margin = 6;
  _aspect = 0;
  _video = false;
  _ratio = this.ratio(); // to perfomance call here
  _scenary = false;

  // create dish
  constructor(scenary) {
    // parent space to render dish
    this._scenary = scenary;

    // create the conference and dish
    this.create();

    // render cameras
    this.render();

    return this;
  }

  // create Dish
  create() {
    // create conference (dish and screen container)
    this._conference = document.createElement("div");
    this._conference.classList.add("Conference");

    // create dish (cameras container)
    this._dish = document.createElement("div");
    this._dish.classList.add("Lider");
    this._dish.classList.add("Scrollbar");

    // append dish to conference
    this._conference.appendChild(this._dish);
  }

  // set dish in scenary
  append() {
    // append to scenary
    this._scenary.appendChild(this._conference);
  }

  // calculate dimensions
  dimensions() {
    this._width = this._dish.offsetWidth - this._margin * 2;
    this._height = this._dish.offsetHeight - this._margin * 2;
  }

  // render cameras of dish
  async render() {
    // delete cameras (only those that are left over)
    if (this._dish.children) {
      for (let i = this._cameras; i < this._dish.children.length; i++) {
        let Camera = this._dish.children[i];
        this._dish.removeChild(Camera);
      }
    }

    // add cameras (only the necessary ones)
    for (let i = this._dish.children.length; i < this._cameras; i++) {
      let Camera = document.createElement("div");
      this._dish.appendChild(Camera);
    }
  }

  // resizer of cameras
  resizer(width) {
    for (var s = 0; s < this._dish.children.length; s++) {
      // camera fron dish (div without class)
      let element = this._dish.children[s];

      // custom margin
      element.style.margin = this._margin + "px";

      // calculate dimensions
      element.style.width = width + "px";
      element.style.height = width * this._ratio + "px";

      // to show the aspect ratio in demo (optional)
      // element.setAttribute("data-aspect", this._ratios[this._aspect]);
    }
  }

  resize() {
    // get dimensions of dish
    this.dimensions();

    // loop (i recommend you optimize this)
    let max = 0;
    let i = 1;
    while (i < 5000) {
      let area = this.area(i);
      if (area === false) {
        max = i - 1;
        break;
      }
      i++;
    }
    // remove margins
    max = max - this._margin * 2;

    if (max < 250) {
      max = 250;
    }

    // set dimensions to all cameras
    this.resizer(max);
  }

  // split aspect ratio (format n:n)
  ratio() {
    var ratio = this._ratios[this._aspect].split(":");
    return ratio[1] / ratio[0];
  }

  // calculate area of dish:
  area(increment) {
    let i = 0;
    let w = 0;
    let h = increment * this._ratio + this._margin * 2;
    while (i < this._dish.children.length) {
      if (w + increment > this._width) {
        w = 0;
        h = h + increment * this._ratio + this._margin * 2;
      }
      w = w + increment + this._margin * 2;
      i++;
    }
    if (h > this._height || increment > this._width) return false;
    else return increment;
  }

  // add new camera
  // add() {
  //   this._cameras++;
  //   this.render();
  //   this.resize();
  // }

  async addOneCamera(user, stream) {
    this._cameras++;

    // create camera
    let Camera = document.createElement("div");
    // add id
    Camera.setAttribute("id", user.id);
    Camera.className = "lider-camera";
    if (!user.avatar) {
      user.avatar = `https://ui-avatars.com/api/?name=${user.username
        .split(" ")
        .join("+")}&background=random&length=1&rounded=true&size=200}`;
    } else {
      Camera.style.backgroundSize = "cover";
    }
    Camera.style.backgroundImage = "url(" + user.avatar + ")";

    let video = document.createElement("video");

    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
    }

    video.className = "lider-camera-video";
    video.srcObject = stream;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsinline = true;
    video.controls = false;

    Camera.appendChild(video);

    // create span to show user name
    let span = document.createElement("span");
    span.innerHTML = user.username;
    span.className = "lider-username-bottom-left";
    // append span to camera
    Camera.appendChild(span);

    this._dish.appendChild(Camera);
    this.resize();
  }

  deleteCamera(id) {
    const iframe = document.getElementById("lider-iframe");

    let camera = iframe.contentWindow.document.getElementById(id);
    console.log(camera);
    this._dish.removeChild(camera);
    this.resize();
  }

  //get webcam
  async getWebcam() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    video.play();
  }

  // remove last camera
  // delete() {
  //   this._cameras--;
  //   this.render();
  //   this.resize();
  // }

  // return ratios
  ratios() {
    return this._ratios;
  }

  // return cameras
  cameras() {
    return this._cameras;
  }

  // set ratio
  aspect(i) {
    this._aspect = i;
    this._ratio = this.ratio();
    this.resize();
  }

  // set screen scenary
  async expand() {
    // detect screen exist
    let screens = this._conference.querySelector(".Screen");
    if (screens) {
      // remove screen
      this._conference.removeChild(screens);
    } else {
      // add div to scenary
      let screen = document.createElement("div");
      screen.classList.add("Screen");

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      stream.getVideoTracks()[0].onended = () => this.expand();
      // create video
      let video = document.createElement("video");
      video.classList.add("Screen-video");
      video.srcObject = stream;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsinline = true;
      video.controls = false;

      // append video to screen
      screen.appendChild(video);
      //fix width for screen
      video.style.width = "100%";
      //set video in center
      video.style.margin = "auto";

      // append first to scenary
      this._conference.prepend(screen);
    }
    this.resize();
  }

  video(camera, callback, hide = false) {
    // check have video
    if (this._dish.children[camera].video) {
      if (hide) {
        // delete video:
        this._dish.children[camera].video = false;
        let videos = this._dish.children[camera].querySelectorAll("video");
        this._dish.children[camera].removeChild(videos[0]);
      }
    } else {
      // set video
      this._dish.children[camera].video = true;

      // create video
      let video = document.createElement("video");
      video.classList.add("loading");

      // random number 1-5
      let filename = "demo.mp4";
      video.src = `./videos/${filename}`;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsinline = true;
      video.controls = false;

      // event to show video
      video.addEventListener(
        "loadedmetadata",
        function () {
          callback(video);
        },
        false
      );

      // append video to camera
      this._dish.children[camera].appendChild(video);
    }
  }
}
