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
let lider;
window.addEventListener("message", function (event) {
  console.log("meet.js received message", event.data);
  if (event.data) {
    const data = JSON.parse(event.data);
    console.log(data);
    // const msg = JSON.parse(msgOutsite);
    lider = new LiderClient();
    lider.user = data.user;
    lider.roomId = data.roomId;
    lider.accessType = data.accessType;
    lider.token = data.token;
    lider.webUrl = data.webUrl;
    lider.inviteUrl = data.inviteUrl;
    console.log("lider", lider);
    // lider.requestJoin({
    //   roomId: data.roomId,
    //   user: data.user,
    //   accessType: "askToJoin",
    // });
  }
});

const pingInterval = setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send("ping");
  }
}, 30000);

class LiderClient {
  constructor() {
    const defaultSettings = {
      configuration: {
        iceServers: [
          { urls: "stun:stun.stunprotocol.org:3478" },
          { urls: "stun:stun.l.google.com:19302" },
        ],
      },
    };

    this.serverDomain = "meet-lider.it-pfiev-dut.tech";

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
    this.accessType = null;
    this.token = null;
    this.inviteUrl = null;

    // this.liderView = new LiderView(document.getElementById("lider-videos"));
    // this.liderView.append();
    // this.liderView.resize();

    // window.addEventListener("resize", () => {
    //   this.liderView.resize();
    // });

    Object.keys(_EVENTS).forEach((event) => {
      this.eventListeners.set(event, []);
    });

    this.initWebSocket();
    this.trigger(_EVENTS.onReady);
  }

  initWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    // console.log(url);
    // const url = "wss://meet-lider.it-pfiev-dut.tech";
    const url = `wss://${this.serverDomain}`;
    this.connection = new WebSocket(url);
    this.connection.onmessage = (data) => this.handleMessage(data);
    this.connection.onclose = () => this.handleClose();
    this.connection.onopen = (event) => {
      this.trigger(_EVENTS.onConnected, event);
      this._isOpen = true;
      this.pingWebSocket();
    };
  }

  pingWebSocket() {
    setInterval(() => {
      if (this._isOpen) {
        this.connection.send("ping");
      }
    }, 30000);
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

  async handleRemoteTrack(stream, user) {
    if (!user.username) {
      console.log("not enough data ", user);
    }
    const username = user.username || user;
    console.log("handleRemoteTrack", stream);
    this.liderView?.addOneCamera(user, stream);
    if (user.id !== this.localUUID && !user.audio) {
      const camera = document.getElementById(user.id);
      const divAudio = camera.getElementsByClassName(
        "lider-audio-bottom-right"
      )[0];
      const audioIconCamera = divAudio.getElementsByTagName("i")[0];
      console.log("audioIconCamera", audioIconCamera, divAudio);
      divAudio.style.background = "#00000070";
      audioIconCamera.classList = "fas fa-microphone-slash";
    }
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
      this.handleRemoteTrack(e.streams[0], peer);
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

  async handlePeers({ userSharingScreen, peers }) {
    if (userSharingScreen) {
      this.consumeScreenShare(userSharingScreen);
    }

    if (peers.length > 0) {
      for (const peer in peers) {
        this.addNewParticipant({ user: peers[peer].user });
        this.updateVideoAudioParticipant({ user: peers[peer].user });
        this.clients.set(peers[peer].id, peers[peer]);
        await this.consumeOnce(peers[peer].user);
      }
    }
  }

  handleAnswer({ sdp }) {
    console.log(sdp);
    const desc = new RTCSessionDescription(sdp);
    this.localPeer.setRemoteDescription(desc).catch((e) => console.log(e));
  }

  async handleNewProducer({ id, user }) {
    if (id === this.localUUID) return;

    console.log("handleNewProducer", user);
    this.addNewParticipant({ user });
    this.updateVideoAudioParticipant({ user });
    this.clients.set(id, user);
    await this.consumeOnce(user);
  }

  sendRequestJoin() {
    if (this.accessType === "askToJoin") {
      this.renderWaitingScreen();
    }

    this.connection.send(
      JSON.stringify({
        type: "request-join",
        token: this.token,
        webUrl: this.webUrl,
        roomId: this.roomId,
        user: this.user,
        accessType: this.accessType,
      })
    );
  }

  handleMessage({ data }) {
    if (data === "pong") {
      console.log("pong");
      return;
    }
    const message = JSON.parse(data);
    switch (message.type) {
      case "welcome":
        this.localUUID = message.id;
        this.user.id = message.id;
        this.sendRequestJoin();
        break;

      case "request-join-success":
        this.handleRequestJoinSuccess(message);
        break;

      case "request-join-error": {
        this.renderErrorScreen(message.message);
        break;
      }

      case "askToJoin/someone-request-join":
        this.handleSORequestJoin(message);
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
        this.liderView?.closeShareScreen();
        this.consumerScreenShare = null;
        break;

      case "remoteUserUpdate":
        this.handleRemoteUserUpdate(message);

      case "forward-chat":
        this.addNewMessage(message);
    }
  }

  handleSORequestJoin(message) {
    const approveFn = (userId) => {
      this.connection.send(
        JSON.stringify({
          type: "askToJoin/approve",
          roomId: this.roomId,
          userId,
        })
      );
      this.removeToast(userId);
    };

    const rejectFn = (userId) => {
      this.connection.send(
        JSON.stringify({
          type: "askToJoin/reject",
          roomId: this.roomId,
          userId,
        })
      );
      this.removeToast(userId);
    };

    this.renderToast(message.user, approveFn, rejectFn);
  }

  handleRemoteUserUpdate(body) {
    if (body.user.id === this.localUUID) return;
    this.updateVideoAudioParticipant({ user: body.user });
    if (body.action === "toggleVideo") {
      const camera = document.getElementById(body.user.id);
      const video = camera.getElementsByTagName("video")[0];

      video.style.visibility = body.user.video ? "visible" : "hidden";
    }

    if (body.action === "toggleAudio") {
      const camera = document.getElementById(body.user.id);
      const divAudio = camera.getElementsByClassName(
        "lider-audio-bottom-right"
      )[0];
      const audioIcon = divAudio.getElementsByTagName("i")[0];

      if (body.user.audio) {
        divAudio.style.background = "#0e79f8";
        audioIcon.classList.toggle("fa-microphone");
        audioIcon.classList.toggle("fa-microphone-slash");
      } else {
        divAudio.style.background = "#00000070";
        audioIcon.classList.toggle("fa-microphone-slash");
        audioIcon.classList.toggle("fa-microphone");
      }
    }
  }
  removeUser({ id }) {
    const { username, consumerId } = this.clients.get(id);
    this.consumers.delete(consumerId);
    this.clients.delete(id);
    this.removeParticipant({ userId: id });
    // document
    //   .querySelector(`#remote_${username}`)
    //   .srcObject.getTracks()
    //   .forEach((track) => track.stop());
    // document.querySelector(`#user_${username}`).remove();
    this.liderView?.deleteCamera(id);
  }

  requestJoin({ roomId, user, accessType }) {
    if (accessType === "askToJoin") {
      this.renderWaitingScreen();
    }

    this.roomId = roomId;
    this.user = user;
    this.user.id = this.localUUID;
    this.connection.send(
      JSON.stringify({
        type: "request-join",
        roomId,
        user,
        accessType,
      })
    );
  }

  handleRequestJoinSuccess(message) {
    this.roomId = message.roomId;
    console.log("request-join-success", this.roomId);

    this.connect({ roomId: this.roomId, user: this.user });
  }

  hangup() {
    //close all peer
    this.localPeer.close();
    this.localPeer = null;
    this.localStream.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.consumers.forEach((consumer) => {
      consumer.close();
    });
    this.connection?.close();
    this.renderHangup();
  }

  async connect({ roomId, user }) {
    //Produce media
    this.renderMeeting();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    setTimeout(() => {
      document
        .getElementById("lider-toggle-video")
        .addEventListener("click", () => this.toggleVideo());
      document
        .getElementById("lider-toogle-audio")
        .addEventListener("click", () => this.toggleAudio());

      document
        .getElementById("lider-share-screen")
        .addEventListener("click", () => this.shareScreen());
      if (!user.video) {
        stream.getVideoTracks()[0].enabled = false;
        this.disableVideo();
      }

      if (!user.audio) {
        stream.getAudioTracks()[0].enabled = false;
        this.disableAudio();
      }
    }, 50);

    this.handleRemoteTrack(stream, this.user);
    this.localStream = stream;

    this.localPeer = this.createPeer();
    this.localStream
      .getTracks()
      .forEach((track) => this.localPeer.addTrack(track, this.localStream));
    this.subscribe();
  }

  copyInviteUrl() {
    console.log("copyInviteUrl", this.inviteUrl);
    // copy this.inviteUrl to clipboard
    navigator.clipboard.writeText(this.inviteUrl);
    this.renderNotification({
      msg: "Invite url copied",
      iconUrl:
        "https://cdn.iconscout.com/icon/free/png-256/checkmark-441-461824.png",
      ttl: 4000,
    });
  }

  enableAudio() {
    const audioIcon = document.getElementById("lider-audio-icon");

    const camera = document.getElementById(this.localUUID);
    const divAudio = camera.getElementsByClassName(
      "lider-audio-bottom-right"
    )[0];
    const audioIconCamera = divAudio.getElementsByTagName("i")[0];

    if (
      this.user.audio &&
      audioIcon.classList.value.includes("fa-microphone-slash")
    ) {
      divAudio.style.background = "#0e79f8";
      audioIconCamera.classList = "fas fa-microphone";

      audioIcon.classList.toggle("fa-microphone");
      audioIcon.classList.toggle("fa-microphone-slash");
      this.localStream.getAudioTracks()[0].enabled = true;
    }
  }

  disableAudio() {
    const audioIcon = document.getElementById("lider-audio-icon");

    const camera = document.getElementById(this.localUUID);
    console.log(camera);
    const divAudio = camera.getElementsByClassName(
      "lider-audio-bottom-right"
    )[0];
    const audioIconCamera = divAudio.getElementsByTagName("i")[0];
    if (
      !this.user.audio &&
      !audioIcon.classList.value.includes("fa-microphone-slash")
    ) {
      divAudio.style.background = "#00000070";
      audioIconCamera.classList = "fas fa-microphone-slash";

      audioIcon.classList.toggle("fa-microphone");
      audioIcon.classList.toggle("fa-microphone-slash");
      this.localStream.getAudioTracks()[0].enabled = false;
    }
  }

  getMemoDivNotifications() {
    let divNotification = document.getElementById("lider-notifications");
    if (!divNotification) {
      divNotification = document.createElement("div");
      divNotification.id = "lider-notifications";
      divNotification.style.position = "absolute";
      divNotification.style.top = "10px";
      divNotification.style.right = "10px";
      divNotification.style.zIndex = "10";
    }
    return divNotification;
  }

  renderNotification({ msg, iconUrl, ttl = 3000 }) {
    const divNotification = this.getMemoDivNotifications();
    const memoHtml = `<div
        id="lider-notification"
        style="
          background-color: #ffffff;
          border-radius: 8px;
          display: flex;
          flex-direction: row;
          padding: 1rem;
          align-items: center;
          box-shadow: 0px 0px 10px 0px #00000060;
        "
      >
        <img
          src="${iconUrl}"
          alt=""
          style="width: 20px; height: 20px; margin-right: 1rem"
        />
        <div
          style="
            border-left: #00000030;
            border-left-style: solid;
            border-left-width: 1px;
            padding-left: 1rem;
          "
        >
          <p style="padding: 4px; color: #00000090">
            ${msg}
          </p>
        </div>
      </div>`;
    divNotification.innerHTML = memoHtml;

    document.body.appendChild(divNotification);
    setTimeout(() => {
      const animationView = document.getElementById("lider-notifications");
      animationView.innerHTML = "";
    }, ttl);
  }

  renderToast(user, approveFn, rejectFn) {
    const html = `
    <div
        id="toast-${user.id}"
        class="w-full max-w-xs p-4 text-gray-500 bg-white rounded-lg shadow dark:bg-gray-800 dark:text-gray-400 my-4"
        role="alert"
      >
        <div class="flex">
          <div
            class="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 text-blue-500 bg-blue-100 rounded-lg dark:text-blue-300 dark:bg-blue-900"
          >
            <img
              class="w-8 h-8 rounded-full"
              src="${user.avatar}"
              alt=""
            />
          </div>
          <div class="ml-3 text-sm font-normal">
            <span
              class="mb-1 text-sm font-semibold text-gray-900 dark:text-white"
              >New join request</span
            >
            <div class="mb-2 text-sm font-normal">
              ${user.username} wants to join your team. What do you want to do?
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <a
                  id="accept-${user.id}"
                  href="#"
                  class="inline-flex justify-center w-full px-2 py-1.5 text-xs font-medium text-center text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-blue-800"
                  >Approve</a
                >
              </div>
              <div>
                <a
                  id="reject-${user.id}"
                  href="#"
                  class="inline-flex justify-center w-full px-2 py-1.5 text-xs font-medium text-center text-gray-900 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 focus:ring-4 focus:outline-none focus:ring-gray-200 dark:bg-gray-600 dark:text-white dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:border-gray-700 dark:focus:ring-gray-700"
                  >Reject</a
                >
              </div>
            </div>
          </div>
        </div>
      </div>`;

    const toast = document.getElementById("toasts");
    toast.innerHTML = html + toast.innerHTML;

    const accept = document.getElementById("accept-" + user.id);
    const reject = document.getElementById("reject-" + user.id);

    accept.addEventListener("click", () => {
      console.log(event?.srcElement.id);
      //split acept-id to id
      const id = event?.srcElement.id.split("accept-")[1];
      approveFn(id);
    });

    reject.addEventListener("click", () => {
      console.log(event?.srcElement.id);
      const id = event?.srcElement.id.split("reject-")[1];
      rejectFn(id);
    });
  }

  removeToast(userId) {
    console.log(userId);
    const toast = document.getElementById(`toast-${userId}`);
    toast.remove();
  }

  toggleAudio() {
    this.user.audio = !this.user.audio;
    if (this.user.audio) {
      this.enableAudio();
    } else {
      this.disableAudio();
    }

    this.connection?.send(
      JSON.stringify({
        type: "updateUser",
        roomId: this.roomId,
        user: this.user,
        action: "toggleAudio",
      })
    );
    this.updateVideoAudioParticipant({ user: this.user });
  }

  enableVideo() {
    const videoIcon = document.getElementById("lider-video-icon");
    if (
      this.user.video &&
      videoIcon.classList.value.includes("fa-video-slash")
    ) {
      videoIcon.classList.toggle("fa-video");
      videoIcon.classList.toggle("fa-video-slash");
      this.localStream.getVideoTracks()[0].enabled = true;
    }

    const camera = document.getElementById(this.localUUID);
    // get the video element
    const video = camera.getElementsByTagName("video")[0];
    video.style.visibility = "visible";
  }

  disableVideo() {
    const videoIcon = document.getElementById("lider-video-icon");
    if (
      !this.user.video &&
      !videoIcon.classList.value.includes("fa-video-slash")
    ) {
      videoIcon.classList.toggle("fa-video-slash");
      videoIcon.classList.toggle("fa-video");
      this.localStream.getVideoTracks()[0].enabled = false;
    }

    const camera = document.getElementById(this.localUUID);
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

    this.connection.send(
      JSON.stringify({
        type: "updateUser",
        roomId: this.roomId,
        user: this.user,
        action: "toggleVideo",
      })
    );
    this.updateVideoAudioParticipant({ user: this.user });

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

  // Script for screen sharing
  async shareScreen() {
    if (this.consumerScreenShare) {
      this.renderPopup({
        title: "Can not share screen",
        msg: `${this.consumerScreenShare.user.username} is already sharing screen.`,
      });
      return;
    }

    if (this.localShareScreenStream) {
      this.renderPopup({
        title: "Can not share screen",
        msg: `You are already sharing screen.`,
      });
      return;
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    console.log(stream.getVideoTracks()[0]);
    stream.getVideoTracks()[0].onended = () => {
      this.stopScreenShare();
    };
    this.liderView?.expand(stream);
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
        user: this.user,
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
    console.log("consume screen share");
    if (message.user.id === this.localUUID) return;

    const consumerScreenShareId = this.uuidv4();
    this.consumerScreenShare = new RTCPeerConnection(
      this.settings.configuration
    );
    this.consumerScreenShare.user = message.user;
    this.consumerScreenShare.id = consumerScreenShareId;
    console.log(this.consumerScreenShare);
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
      this.liderView?.expand(e.streams[0]);
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

  renderPopup({ title, msg }) {
    const modal = document.getElementsByClassName("lider-modal")[0];
    modal.getElementsByTagName("p")[0].innerHTML = msg;
    modal.getElementsByTagName("h3")[0].innerHTML = title;
    modal.classList.remove("ease-in");
    modal.classList.remove("duration-200");
    modal.classList.add("ease-out");
    modal.classList.add("duration-300");
    modal.classList.remove("opacity-0");
    modal.classList.remove("translate-y-4");
    modal.classList.remove("sm:translate-y-0");
    modal.classList.remove("sm:scale-95");
    modal.classList.add("opacity-100");
    modal.classList.add("translate-y-0");
    modal.classList.add("sm:scale-100");
    setTimeout(() => {
      modal.classList.remove("hidden");
    }, 200);
  }

  stopScreenShare() {
    console.log("stop screen share", this.localShareScreenStream);
    if (!this.localShareScreenStream) return;

    this.liderView?.closeShareScreen();
    this.localShareScreenStream = null;
    console.log("inform stop screen share");
    this.connection.send(
      JSON.stringify({
        type: "stop_screen_share",
        uqid: this.localUUID,
        roomId: this.roomId,
      })
    );
  }

  renderWaitingScreen() {
    const body = document.getElementsByTagName("body")[0];
    const html = `  <div class="flex items-center justify-center h-screen">
      <div class="centered-div flex flex-col items-center">
        <img
          src="${this.user.avatar}"
          alt="logo"
          class="w-32 h-32 rounded-full shadow-md ring-2 ring-gray-300"
        />
        <p class="my-8">
          You are in the waiting room. Please wait for the host to let you in.
        </p>
        <div role="status">
          <svg
            aria-hidden="true"
            class="w-8 h-8 mr-2 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600"
            viewBox="0 0 100 101"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
              fill="currentColor"
            />
            <path
              d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
              fill="currentFill"
            />
          </svg>
          <span class="sr-only">Loading...</span>
        </div>
      </div>
    </div>`;
    body.innerHTML = html;
  }

  renderErrorScreen(errorMsg) {
    const body = document.getElementsByTagName("body")[0];
    const html = `
       <div class="flex items-center justify-center h-screen">
      <img
        src="https://cdn.pixabay.com/photo/2017/02/12/21/29/false-2061132_1280.png"
        alt="hangup"
        class="w-32 h-32 mr-8"
      />

      <p>
        <span class="text-2xl">
          ${errorMsg}
        </span>
        <br />
      </p>
    </div>
    `;
    body.innerHTML = html;
  }

  addNewParticipant({ user }) {
    const participant = document.getElementById("participants-list");
    if (document.getElementById(`participant-${user.id}`)) return;
    const html = `
    <div class="participant" id="participant-${user.id}">
      <div class="flex items-center space-x-4">
        <img
          src="${user.avatar}"
          alt=""
          class="w-14 h-14 rounded-full"
        />
        <p class="text-white">${user.username}</p>
      </div>
      <div class="space-x-4">
        <i class="fas fa-microphone-slash" style="color: #ffffff"></i>
        <i class="fas fa-video-slash" style="color: #ffffff"></i>
      </div>
    </div>
    `;
    participant.innerHTML += html;
  }

  removeParticipant({ userId }) {
    const participant = document.getElementById("participants-list");
    const participantToRemove = document.getElementById(
      `participant-${userId}`
    );
    participant.removeChild(participantToRemove);
  }

  updateVideoAudioParticipant({ user }) {
    const participant = document.getElementById(`participant-${user.id}`);
    const audioIcon = participant.getElementsByTagName("i")[0];
    const videoIcon = participant.getElementsByTagName("i")[1];

    if (user.audio) {
      audioIcon.classList = "fas fa-microphone";
    } else {
      audioIcon.classList = "fas fa-microphone-slash";
    }

    if (user.video) {
      videoIcon.classList = "fas fa-video";
    } else {
      videoIcon.classList = "fas fa-video-slash";
    }
  }

  addNewMessage({ user, message }) {
    const messagesList = document.getElementById("messages-list");
    if (document.getElementById(message.id)) return;
    const html = `
    <div class="message" id=${message.id}>
      <div class="message-name">
        <p>${user.username}</p>
        <p>${new Date().toLocaleTimeString()}</p>
      </div>
      <div class="flex space-x-4">
        <img
          src="${user.avatar}"
          alt=""
          class="w-8 h-8 rounded-full"
        />
        <p class="message-content" style="max-width: 200px;">${
          message.content
        }</p>
        </div>
      </div>
    </div>
    `;
    messagesList.innerHTML += html;
    //scroll to bottom
    messagesList.scrollTop = messagesList.scrollHeight;
  }

  renderMeeting() {
    const body = document.getElementsByTagName("body")[0];
    const html = `<div id="toasts" class="absolute right-10 top-10 z-10 flex flex-col"></div>

    <div id="lider-main">
      <div id="lider-meeting-area">
        <div id="lider-video-area">
          <div id="lider-videos"></div>
        </div>
        <div id="lider-toolbox">
          <div id="lider-toolbox-left" class="lider-toolbox-button-container">
            <button id="lider-toogle-audio" class="lider-toolbox-button">
              <i
                id="lider-audio-icon"
                class="fa fa-solid fa-microphone fa-beat fa-2xl"
                style="color: #ffffff"
              ></i>
              Audio
            </button>
            <button id="lider-toggle-video" class="lider-toolbox-button">
              <i
                id="lider-video-icon"
                class="fa fa-solid fa-video fa-2xl"
                style="color: #ffffff"
              ></i>
              Video
            </button>
            ${
              !!this.inviteUrl
                ? `<div class="relative">
              <button id="lider-copy-invite-url" class="lider-toolbox-button">
                <i
                  id="lider-video-icon"
                  class="fa fa-solid fa-link fa-2xl"
                  style="color: #ffffff"
                ></i>
                Invite
              </button>
              <div>
                <div
                  id="lider-invite-url"
                  class="hidden absolute bg-white bottom-14 left-2 rounded-md shadow-md p-2 flex"
                >
                  <input
                    id="lider-invite-url-input"
                    type="text"
                    readonly="readonly"
                    value="${this.inviteUrl}"
                    class="rounded-md px-2 py-1 w-30 text-sm"
                  />
                  <button
                    id="lider-invite-url-copy"
                    class="ml-2 px-2 py-1 rounded-md bg-blue-500 text-white text-sm"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>`
                : ""
            }
          </div>
          <div id="lider-toolbox-center" class="lider-toolbox-button-container">
            <button id="lider-hangup" class="lider-toolbox-button">
              Hang up
            </button>
          </div>
          <div id="lider-toolbox-right" class="lider-toolbox-button-container">
            <button id="lider-fullscreen" class="lider-toolbox-button">
              Full Screen
            </button>
            <button id="lider-share-screen" class="lider-toolbox-button">
              Share screen
            </button>
            <button id="lider-members" class="lider-toolbox-button">
              <i class="fas fa-users" style="color: #ffffff"></i>
            </button>
          </div>
        </div>
      </div>
            <div id="lider-chat" class="w-1/4 hidden">
        <div id="lider-chat-info">
          <div id="current-user">
            <div class="flex justify-end m-4 space-x-4 h-16 items-center">
              <p class="text-white text-xl">${this.user.username}</p>
              <img
                src="${this.user.avatar}"
                alt=""
                class="w-14 h-14 rounded-full"
              />
            </div>
          </div>
          <div id="participants" class="h-fit">
            <div
              id="participants-title"
              class="flex space-x-4 p-4 items-center text-white"
            >
              <i class="fas fa-user-friends" style="color: #ffffff"></i>
              <p>Participants</p>
            </div>
          </div>
          <div id="participants-list" class="flex flex-col">
          </div>
          <div id="chat">
            <div
              id="participants-title"
              class="flex space-x-4 p-4 items-center text-white"
            >
              <i class="fas fa-comment-alt" style="color: #ffffff"></i>
              <p>Chat</p>
            </div>
          </div>
          <div id="messages-list">
          </div>
        </div>
        <div id="lider-chat-input">
          <div id="input-message">
            <div class="flex items-center space-x-4 p-4">
              <input
                type="text"
                placeholder="Type a message"
                class="w-full rounded-md p-2"
              />
              <button id="lider-chat-btn" class="rounded-md bg-blue-500 text-white p-2">
                <i class="fas fa-paper-plane"></i>
              </button>

            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      class="absolute left-1/4 top-1/4 h-1/2 w-1/2 z-10 bg-gray-800 border rounded hidden p-4 space-y-4"
      id="preview"
    >
      <div class="h-3/4 flex justify-center items-center">
        <img
          id="blah"
          src="#"
          alt="your image"
          class="object-contain max-w-full max-h-full"
        />
      </div>
      <div class="flex justify-between items-center">
        <div>
          <p id="image-prev-name" class="text-white"></p>
          <p id="image-prev-size" class="text-white"></p>
        </div>
        <div class="space-x-4">
          <button id="cancel-submit-file" class="bg-gray-50 border p-2 rounded">
            Cancel
          </button>
          <button
            id="submit-file"
            class="bg-blue-500 border p-2 rounded text-white"
            onclick="submitFile()"
          >
            Send
          </button>
        </div>
      </div>
    </div>
    `;
    body.innerHTML = html;

    const membersBtn = document.getElementById("lider-members");
    membersBtn.addEventListener("click", () => {
      const chat = document.getElementById("lider-chat");
      chat.classList.toggle("hidden");
    });

    const chatBtn = document.getElementById("lider-chat-btn");
    chatBtn.addEventListener("click", () => {
      const input = document
        .getElementById("lider-chat-input")
        .getElementsByTagName("input")[0];
      const msg = input.value;
      if (msg) {
        const id = new Date().getTime() + this.user.id;
        const payload = {
          type: "send-chat",
          roomId: this.roomId,
          user: this.user,
          message: {
            content: msg,
            id,
          },
        };
        this.addNewMessage(payload);
        this.connection.send(JSON.stringify(payload));
        input.value = "";
      }
    });

    const inviteBtn = document.getElementById("lider-copy-invite-url");
    inviteBtn?.addEventListener("click", () => {
      const inviteUrl = document.getElementById("lider-invite-url");
      inviteUrl.classList.toggle("hidden");

      const copyBtn = document.getElementById("lider-invite-url-copy");
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(this.inviteUrl);
        this.renderNotification({
          msg: "Invite url copied",
          iconUrl: "https://cdn-icons-png.flaticon.com/512/178/178921.png",
          ttl: 4000,
        });
      });
    });

    const attachBtn = document.getElementById("attach-btn");
    attachBtn.onclick = () => {
      const fileInput = document.getElementById("inputFile");
      fileInput.click();
    };

    const fileInput = document.getElementById("inputFile");
    fileInput.onchange = () => {
      const modal = document.getElementById("preview");
      modal.classList.remove("hidden");
      const selectedFile = fileInput.files[0];
      const imagePreview = document.getElementById("blah");
      imagePreview.src = URL.createObjectURL(selectedFile);
      const imagePrevName = document.getElementById("image-prev-name");
      imagePrevName.innerHTML = selectedFile.name;
      const imagePrevSize = document.getElementById("image-prev-size");
      imagePrevSize.innerHTML = (selectedFile.size / 1024).toFixed(2) + " KB";
    };

    const cancelSubmitFile = document.getElementById("cancel-submit-file");
    cancelSubmitFile.addEventListener("click", () => {
      const modal = document.getElementById("preview");
      modal.classList.add("hidden");
    });
    const submitFile = document.getElementById("submit-file");
    submitFile.addEventListener("click", () => {
      const fileInput = document.getElementById("inputFile");
      const selectedFile = fileInput.files[0];
      const formData = new FormData();
      formData.append("file", selectedFile);
      fetch("https://files-lider.it-pfiev-dut.tech/api/upload", {
        method: "POST",
        body: formData,
      })
        .then((res) => response.json())
        .then((result) => {
          const payload = {
            type: "send-chat",
            roomId: this.roomId,
            user: this.user,
            message: {
              type: "file",
              content: payload,
              id,
            },
          };
          this.addNewMessage(payload);
          this.connection.send(JSON.stringify(payload));
        });
      fileInput.value = "";
    });

    this.liderView = new LiderView(document.getElementById("lider-videos"));
    console.log(this.liderView);
    this.liderView.append();
    this.liderView.resize();
    this.addNewParticipant({ user: this.user });
    this.updateVideoAudioParticipant({ user: this.user });

    window.addEventListener("resize", () => {
      this.liderView.resize();
    });

    const hangup = document.getElementById("lider-hangup");
    hangup.addEventListener("click", () => this.hangup());
  }

  renderHangup() {
    const body = document.getElementsByTagName("body")[0];
    const html = `<div class="flex items-center justify-center h-screen">
      <img
        src="https://icons.veryicon.com/png/o/miscellaneous/cloud-call-center/hang-up.png"
        alt="hangup"
        class="w-32 h-32 mr-8"
      />

      <p>
        <span class="text-2xl">
          Your call has ended. Thank you for using our service!
        </span>
        <br />
        <span class="text-gray-500">You can close this tab</span>
      </p>
    </div>`;
    body.innerHTML = html;
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
    console.log(" new lider view");
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
    let Camera = document.getElementById(user.id);
    if (Camera) {
      const video = Camera.querySelector("video");
      video.srcObject = stream;
      video.autoplay = true;
      return;
    }

    this._cameras++;
    Camera = document.createElement("div");
    Camera.setAttribute("id", user.id);
    Camera.className = "lider-camera";
    if (!user.avatar) {
      user.avatar = `https://ui-avatars.com/api/?name=${user.username
        .split(" ")
        .join("+")}&background=random&length=1&rounded=true&size=128}`;
    }
    if (!user.avatar.startsWith("https://ui-avatars.com/api/")) {
      Camera.style.backgroundSize = "cover";
    }

    Camera.style.backgroundImage = "url(" + user.avatar + ")";
    let video = document.createElement("video");

    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
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

    let span = document.createElement("span");
    span.innerHTML = user.username;
    span.className = "lider-username-bottom-left";
    Camera.appendChild(span);

    let divAudio = document.createElement("div");
    divAudio.className = "lider-audio-bottom-right";
    let audio = document.createElement("i");
    audio.className = "fas fa-microphone";
    divAudio.appendChild(audio);
    Camera.appendChild(divAudio);

    this._dish.appendChild(Camera);
    console.log(this._dish);
    this.resize();
  }

  deleteCamera(id) {
    let camera = document.getElementById(id);
    this._dish.removeChild(camera);
    this.resize();
  }

  //get webcam
  async getWebcam() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
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
  closeShareScreen() {
    let screens = this._conference.querySelector(".Screen");
    if (screens) {
      this._conference.removeChild(screens);
    }
    this.resize();
  }

  async expand(stream) {
    // detect screen exist
    let screens = this._conference.querySelector(".Screen");
    if (screens) {
      // remove screen
      this._conference.removeChild(screens);
    } else {
      // add div to scenary
      let screen = document.createElement("div");
      screen.classList.add("Screen");

      if (!stream) {
        // get screen stream
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
      }

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
