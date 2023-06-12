class LiderClient {
  constructor(containerId) {
    console.log("Lider Meet SDK");
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error("Container is required");
    }
    this.iframeDomain = "https://localhost:5001/meet";
    this.user = null;
    this.token = null;
    this.url = null;
    this.roomId = null;
    this.accessType = null;
    this.inviteUrl = null;

    this.webUrl = window.location.host;
  }

  join({ roomId, user, token, inviteUrl, accessType = "public" }) {
    if (!roomId) {
      throw new Error("Room id is required");
    }

    if (!user) {
      throw new Error("User is required");
    }

    if (!token) {
      throw new Error("Token is required");
    }

    if (!user.username) {
      throw new Error("User name is required");
    }

    if (!user.video) {
      user.video = false;
    }

    if (!user.audio) {
      user.audio = false;
    }

    if (!user.avatar) {
      user.avatar = `https://ui-avatars.com/api/?name=${user.username
        .split(" ")
        .join("+")}&background=random&length=1&rounded=true&size=128`;
    }

    this.accessType = accessType;
    this.user = user;
    this.token = token;
    this.roomId = roomId;
    this.inviteUrl = inviteUrl;

    const iframe = this.createIframe();
    this.container.appendChild(iframe);
  }
  preparePostMessage() {
    const message = {
      accessType: this.accessType,
      roomId: this.roomId,
      user: this.user,
      token: this.token,
      webUrl: this.webUrl,
      inviteUrl: this.inviteUrl,
    };

    return JSON.stringify(message);
  }

  createIframe() {
    const iframe = document.createElement("iframe");
    iframe.src = this.iframeDomain;
    iframe.id = "lider-meet-iframe";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.allow =
      "camera; microphone; fullscreen; display-capture; clipboard-read; clipboard-write";
    iframe.allowFullscreen = true;
    iframe.frameBorder = 0;

    iframe.addEventListener("load", () => {
      iframe.contentWindow.postMessage(
        this.preparePostMessage(),
        this.iframeDomain
      );
    });

    return iframe;
  }
}
