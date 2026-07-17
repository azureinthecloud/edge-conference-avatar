// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.
// Rewritten for Kiri panel-discussion mode with Craig and Naas.

var speechRecognizer
var avatarSynthesizer
var peerConnection
var peerConnectionDataChannel
var messages = []
var messageInitiated = false
var dataSources = []
var sentenceLevelPunctuations = ['.', '?', '!', ':', ';', '。', '？', '！', '：', '；']
var enableDisplayTextAlignmentWithSpeech = true
var byodDocRegex = new RegExp(/\[doc(\d+)\]/g)
var isSpeaking = false
var isReconnecting = false
var speakingText = ''
var spokenTextQueue = []
var repeatSpeakingSentenceAfterReconnection = true
var sessionActive = false
var userClosedSession = false
var lastInteractionTime = new Date()
var lastSpeakTime
var imgUrl = ''

function el(id) {
    return document.getElementById(id)
}

function val(id, fallback = '') {
    const node = el(id)
    return node ? (node.value || fallback) : fallback
}

function checked(id, fallback = false) {
    const node = el(id)
    return node ? !!node.checked : fallback
}

function setDisabled(id, state) {
    const node = el(id)
    if (node) node.disabled = state
}

function encode(text) {
    const div = document.createElement('div')
    div.innerText = text
    return div.innerHTML
}

function normalizeForSpeech(text) {
    return (text || '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/^[-•]\s+/gm, '')
        .replace(/\[(doc\d+)\]/g, '')
        .replace(/\n{2,}/g, '\n')
        .replace(/\s+/g, ' ')
        .trim()
}

function getActiveSpeaker() {
    return val('activeSpeaker', 'Craig')
}

function getResponseMode() {
    return val('responseMode', 'react')
}

function buildSystemPrompt() {
    return `
You are Kiri, a natural third speaker in a live business discussion with Craig and Naas.

Roles in the room:
- Craig frames the big ideas and brings energy.
- Naas adds commercial and business context.
- You are Kiri: calm, clear, smart, warm, and concise.

Your job:
- Sound like a real person in the room, not a chatbot.
- React first to what Craig or Naas just said.
- Then add interpretation, practical meaning, nuance, or a smooth transition.
- Keep responses short and natural for spoken delivery.
- Usually respond in 2 to 4 sentences.
- Never say you are an AI assistant.
- Never say “How can I help?” or “Here is a summary.”
- End naturally, often handing back to Craig or Naas.

Speaking style:
- Conversational and commercially aware.
- Natural ANZ business tone.
- Light humour occasionally, but always professional.
`
}

function initMessages() {
    messages = []
    messages.push({
        role: 'system',
        content: buildSystemPrompt()
    })
    messageInitiated = true
}

function connectAvatar() {
    const cogSvcRegion = val('region')
    const cogSvcSubKey = val('APIKey')
    if (!cogSvcSubKey) {
        alert('Please fill in the API key of your speech resource.')
        return
    }

    const privateEndpointEnabled = checked('enablePrivateEndpoint')
    const privateEndpointValue = val('privateEndpoint')
    const privateEndpoint = privateEndpointValue.startsWith('https://') ? privateEndpointValue.slice(8) : privateEndpointValue
    if (privateEndpointEnabled && !privateEndpoint) {
        alert('Please fill in the Azure Speech endpoint.')
        return
    }

    const talkingAvatarCharacter = val('talkingAvatarCharacter', 'lisa')
    const talkingAvatarStyle = val('talkingAvatarStyle', 'casual-sitting')
    const customVoiceEndpointId = val('customVoiceEndpointId')
    const ttsVoice = val('ttsVoice', 'en-NZ-MollyNeural')

    const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion)
    speechSynthesisConfig.speechSynthesisVoiceName = ttsVoice
    if (customVoiceEndpointId) {
        speechSynthesisConfig.endpointId = customVoiceEndpointId
    }

    const avatarConfig = new SpeechSDK.AvatarConfig(talkingAvatarCharacter, talkingAvatarStyle)

    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig)
    avatarSynthesizer.avatarEventReceived = function (s, e) {
        console.log('Avatar event:', e.description)
    }

    const xhr = new XMLHttpRequest()
    const iceServerUrl = privateEndpointEnabled
        ? `https://${privateEndpoint}/tts/cognitiveservices/avatar/relay/token/v1`
        : `https://${cogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`

    xhr.open('GET', iceServerUrl)
    xhr.setRequestHeader('Ocp-Apim-Subscription-Key', cogSvcSubKey)
    xhr.onload = function () {
        const responseData = JSON.parse(xhr.responseText)
        const iceServer = {
            urls: responseData.Urls,
            username: responseData.Username,
            credential: responseData.Password
        }

        peerConnection = new RTCPeerConnection({ iceServers: [iceServer] })

        peerConnection.ontrack = function (event) {
            const mediaPlayer = el('mediaPlayer')
            if (!mediaPlayer) return
            mediaPlayer.srcObject = event.streams[0]
            mediaPlayer.autoplay = true
            mediaPlayer.playsInline = true
        }

        peerConnection.addTransceiver('video', { direction: 'sendrecv' })
        peerConnection.addTransceiver('audio', { direction: 'sendrecv' })

        peerConnection.ondatachannel = function (event) {
            peerConnectionDataChannel = event.channel
            peerConnectionDataChannel.onmessage = function (e) {
                console.log('Data channel message:', e.data)
            }
        }

        avatarSynthesizer.startAvatarAsync(peerConnection).then((result) => {
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted || result.reason === SpeechSDK.ResultReason.SynthesizingAudioStarted) {
                sessionActive = true
                userClosedSession = false
                setDisabled('startSession', true)
                setDisabled('stopSession', false)
                const status = el('sessionStatus')
                if (status) status.innerHTML = 'Connected'
                if (!messageInitiated) initMessages()
            } else {
                console.log('Unable to start avatar:', result)
            }
        }).catch((error) => {
            console.log('Avatar start failed:', error)
        })
    }
    xhr.send()
}

function disconnectAvatar() {
    userClosedSession = true
    sessionActive = false
    isSpeaking = false
    speakingText = ''
    spokenTextQueue = []

    if (avatarSynthesizer) {
        avatarSynthesizer.close()
        avatarSynthesizer = null
    }
    if (peerConnection) {
        peerConnection.close()
        peerConnection = null
    }

    setDisabled('startSession', false)
    setDisabled('stopSession', true)
    setDisabled('stopSpeaking', true)

    const status = el('sessionStatus')
    if (status) status.innerHTML = 'Disconnected'
}

function buildPanelPrompt(userQuery, activeSpeaker, mode) {
    const modeInstructions = {
        react: 'Respond briefly with agreement, interpretation, or reframing.',
        expand: 'Build on the point with one extra practical insight.',
        transition: 'Bridge naturally to the next idea or speaker handoff.',
        challenge: 'Offer a polite, constructive caution or qualifier.'
    }

    return `
Speaker who just spoke: ${activeSpeaker}
Response mode: ${mode}
Instruction: ${modeInstructions[mode] || modeInstructions.react}

What was just said:
${userQuery}

Respond as Kiri in a natural live panel discussion.
Keep it concise, conversational, and suitable for speaking aloud.
Acknowledge the point first, then add insight.
Use 2 to 4 spoken sentences.
`
}

function appendMessage(label, message) {
    const chatHistoryTextArea = el('chatHistory')
    if (!chatHistoryTextArea) return
    chatHistoryTextArea.innerHTML += `<br/><br/><strong>${encode(label)}:</strong> ${message}`
    chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight
}

function handleUserQuery(userQuery, userQueryHTML, imgUrlPath) {
    if (!messageInitiated) initMessages()

    lastInteractionTime = new Date()
    const activeSpeaker = getActiveSpeaker()
    const responseMode = getResponseMode()
    const contextualPrompt = buildPanelPrompt(userQuery, activeSpeaker, responseMode)

    let contentMessage = contextualPrompt
    if (imgUrlPath && imgUrlPath.trim()) {
        contentMessage = [
            { type: 'text', text: contextualPrompt },
            { type: 'image_url', image_url: { url: imgUrlPath } }
        ]
    }

    messages.push({
        role: 'user',
        content: contentMessage
    })

    appendMessage(activeSpeaker, userQueryHTML || encode(userQuery))
    requestChatCompletion()
}

async function requestChatCompletion() {
    const azureOpenAIEndpoint = val('azureOpenAIEndpoint')
    const azureOpenAIApiKey = val('azureOpenAIApiKey')
    const azureOpenAIDeploymentName = val('azureOpenAIDeploymentName')
    const azureOpenAIApiVersion = val('azureOpenAIApiVersion', '2024-10-21')

    if (!azureOpenAIEndpoint || !azureOpenAIApiKey || !azureOpenAIDeploymentName) {
        alert('Please fill in Azure OpenAI endpoint, API key, and deployment name.')
        return
    }

    const url = `${azureOpenAIEndpoint}/openai/deployments/${azureOpenAIDeploymentName}/chat/completions?api-version=${azureOpenAIApiVersion}`

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': azureOpenAIApiKey
        },
        body: JSON.stringify({
            messages: messages,
            temperature: 0.7,
            max_tokens: 300,
            stream: true
        })
    })

    if (!response.ok) {
        const errorText = await response.text()
        console.log('Chat completion failed:', errorText)
        appendMessage('Kiri', 'Sorry, I hit a problem generating the response.')
        return
    }

    appendMessage('Kiri', '<span id="kiriStream"></span>')

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let fullReply = ''
    let sentenceBuffer = ''

    while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.replace(/^data:\s*/, '')
            if (data === '[DONE]') continue

            try {
                const parsed = JSON.parse(data)
                const token = parsed.choices?.[0]