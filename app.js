let peerConnection;
let avatarSynthesizer;
let speechConfig;
let recognizer;

const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg;
  console.log(msg);
}

async function getConfig() {
  // In production, fetch from your own API route instead of window.APP_CONFIG,
  // so keys never sit in client-side JS. See api/get-config/index.js.
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
  const cfg = await getConfig();
  if (!cfg.SPEECH_KEY || !cfg.SPEECH_REGION) {
    setStatus("Missing Speech key/region. Configure api/get-config or config.js.");
    return;
  }

  setStatus("Fetching ICE token...");
  const ice = await fetchIceToken(cfg.SPEECH_KEY, cfg.SPEECH_REGION);

  peerConnection = new RTCPeerConnection({
    iceServers: [{
      urls: [ice.Urls[0]],
      username: ice.Username,
      credential: ice.Password
    }]
  });

  const remoteVideoDiv = document.getElementById("remoteVideo");
  remoteVideoDiv.innerHTML = "";

  peerConnection.ontrack = function (event) {
    if (event.track.kind === "video") {
      const videoEl = document.createElement("video");
      videoEl.id = "videoPlayer";
      videoEl.autoplay = true;
      videoEl.srcObject = event.streams[0];
      remoteVideoDiv.appendChild(videoEl);
    }
    if (event.track.kind === "audio") {
      const audioEl = document.createElement("audio");
      audioEl.id = "audioPlayer";
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

  setStatus("Starting avatar...");
  await avatarSynthesizer.startAvatarAsync(peerConnection);
  setStatus("Avatar ready. Hold Talk to speak with it.");

  window._cfg = cfg;
}

async function sendToGPT(userText, cfg) {
  setStatus('You said: "' + userText + '" — thinking...');

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userText, systemPrompt: cfg.SYSTEM_PROMPT })
  });

  if (!res.ok) {
    setStatus("Error calling chat API: " + res.status);
    return;
  }
  const data = await res.json();
  const replyText = data.reply;

  setStatus("Avatar replying...");
  await avatarSynthesizer.speakTextAsync(replyText);
  setStatus("Avatar ready. Hold Talk to speak with it.");
}

function startListening() {
  if (!window._cfg) { setStatus("Start the avatar first."); return; }
  const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
  setStatus("Listening...");
  recognizer.recognizeOnceAsync(result => {
    if (result.text) {
      sendToGPT(result.text, window._cfg);
    } else {
      setStatus("Didn't catch that, try again.");
    }
    recognizer.close();
  });
}

function stopAvatar() {
  if (avatarSynthesizer) avatarSynthesizer.close();
  if (peerConnection) peerConnection.close();
  setStatus("Stopped.");
}

document.getElementById("startBtn").addEventListener("click", startAvatar);
document.getElementById("talkBtn").addEventListener("click", startListening);
document.getElementById("stopBtn").addEventListener("click", stopAvatar);
