let peerConnection;
let avatarSynthesizer;
let speechConfig;
let recognizer;
let isListening = false;
let cfg;

const captionBar = document.getElementById("captionBar");
const listeningIndicator = document.getElementById("listeningIndicator");
const idleOverlay = document.getElementById("idleOverlay");
const remoteVideoDiv = document.getElementById("remoteVideo");

function showCaption(text, autohideMs) {
  captionBar.textContent = text;
  captionBar.classList.add("show");
  if (autohideMs) {
    clearTimeout(captionBar._t);
    captionBar._t = setTimeout(() => captionBar.classList.remove("show"), autohideMs);
  }
}

async function getConfig() {
  try {
    const res = await fetch("/api/get-config");
    if (res.ok) return await res.json();
  } catch (e) {
    console.log("Falling back to local config.js (dev only)");
  }
  return window.APP_CONFIG;
}

async function fetchIceToken(speechKey, speechRegion) {
  const res = await fetch(
    `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`,
    { headers: { "Ocp-Apim-Subscription-Key": speechKey } }
  );
  if (!res.ok) throw new Error("Failed to fetch ICE token: " + res.status);
  return await res.json();
}

async function startAvatar() {
  idleOverlay.style.display = "none";
  cfg = await getConfig();
  if (!cfg.SPEECH_KEY || !cfg.SPEECH_REGION) {
    showCaption("Missing Speech key/region config.", 5000);
    return;
  }

  const ice = await fetchIceToken(cfg.SPEECH_KEY, cfg.SPEECH_REGION);

  peerConnection = new RTCPeerConnection({
    iceServers: [{
      urls: [ice.Urls[0]],
      username: ice.Username,
      credential: ice.Password
    }]
  });

  remoteVideoDiv.innerHTML = "";

  peerConnection.ontrack = function (event) {
    if (event.track.kind === "video") {
      const videoEl = document.createElement("video");
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.srcObject = event.streams[0];
      remoteVideoDiv.appendChild(videoEl);
    }
    if (event.track.kind === "audio") {
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.srcObject = event.streams[0];
      remoteVideoDiv.appendChild(audioEl);
    }
  };

  peerConnection.addTransceiver("video", { direction: "sendrecv" });
  peerConnection.addTransceiver("audio", { direction: "sendrecv" });

  speechConfig = SpeechSDK.SpeechConfig.fromSubscription(cfg.SPEECH_KEY, cfg.SPEECH_REGION);
  speechConfig.speechSynthesisVoiceName = cfg.VOICE_NAME;

  const avatarConfig = new SpeechSDK.AvatarConfig(cfg.AVATAR_CHARACTER, cfg.AVATAR_STYLE);
  avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);

  await avatarSynthesizer.startAvatarAsync(peerConnection);

  if (cfg.GREETING_LINE) {
    await avatarSynthesizer.speakTextAsync(cfg.GREETING_LINE);
  }
}

async function sendToGPT(userText) {
  showCaption('You said: "' + userText + '"', null);

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userText, systemPrompt: cfg.SYSTEM_PROMPT })
  });

  if (!res.ok) {
    showCaption("Hmm, having trouble thinking of a reply.", 4000);
    return;
  }
  const data = await res.json();
  const replyText = data.reply;

  showCaption(replyText, null);
  await avatarSynthesizer.speakTextAsync(replyText);
  setTimeout(() => captionBar.classList.remove("show"), 3000);
}

function startListening() {
  if (!avatarSynthesizer || isListening) return;
  isListening = true;
  listeningIndicator.classList.add("active");

  const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizeOnceAsync(result => {
    isListening = false;
    listeningIndicator.classList.remove("active");
    if (result.text) {
      sendToGPT(result.text);
    }
    recognizer.close();
  });
}

function stopAvatar() {
  if (avatarSynthesizer) avatarSynthesizer.close();
  if (peerConnection) peerConnection.close();
  remoteVideoDiv.innerHTML = "";
  idleOverlay.style.display = "flex";
}

idleOverlay.addEventListener("click", startAvatar);
document.body.addEventListener("click", () => {
  if (idleOverlay.style.display !== "none") startAvatar();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    if (idleOverlay.style.display !== "none") { startAvatar(); return; }
    startListening();
  }
  if (e.code === "Escape") {
    stopAvatar();
  }
});