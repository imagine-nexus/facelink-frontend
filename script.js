const RENDER_SERVER = 'facelink-backend.onrender.com'; 

const socket = io(`https://${RENDER_SERVER}`, {
    transports: ['websocket'],
    withCredentials: true
});

const videoGrid = document.getElementById('video-grid');
const joinContainer = document.getElementById('join-container');
const videoInterface = document.getElementById('video-interface');
const roomInput = document.getElementById('room-input');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const createBtn = document.getElementById('create-btn');
const roomTitle = document.getElementById('room-title');
const copyBtn = document.getElementById('copy-btn');

// Control Dock Elements
const micBtn = document.getElementById('mic-btn');
const camBtn = document.getElementById('cam-btn');
const leaveBtn = document.getElementById('leave-btn');
const participantCount = document.getElementById('participant-count');

// Panels
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const chatPanel = document.getElementById('chat-panel');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessages = document.getElementById('chat-messages');

let myPeer;
let myStream;
let myName = '';
let currentRoomId = '';
let isMicEnabled = true;
let isCamEnabled = true;

const peers = {};
const peerDOMWrappers = {};
let participantList = new Set();

if (window.location.hash) {
    roomInput.value = window.location.hash.substring(1);
}

createBtn.addEventListener('click', () => {
    const code = `${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 6)}`;
    initiateCall(code);
});

joinBtn.addEventListener('click', () => {
    const roomId = roomInput.value.trim();
    if (!roomId) return alert('Please input a valid room invitation code');
    initiateCall(roomId);
});

leaveBtn.addEventListener('click', () => {
    window.location.reload();
});

copyBtn.addEventListener('click', () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#${currentRoomId}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
        const originalText = copyBtn.innerText;
        copyBtn.innerText = "Copied! ✓";
        setTimeout(() => copyBtn.innerText = originalText, 2000);
    });
});

chatToggleBtn.addEventListener('click', () => {
    chatPanel.classList.toggle('hidden');
    chatMessages.scrollTop = chatMessages.scrollHeight; 
});

closeChatBtn.addEventListener('click', () => {
    chatPanel.classList.add('hidden');
});

sendChatBtn.addEventListener('click', dispatchMessage);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') dispatchMessage(); });

function dispatchMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('send-chat-message', text);
    appendMessageBubble(text, myName, 'local');
    chatInput.value = '';
}

function appendMessageBubble(text, sender, originType) {
    const container = document.createElement('div');
    container.className = `message-container ${originType}`;

    const author = document.createElement('div');
    author.className = 'msg-author';
    author.innerText = originType === 'local' ? 'You' : sender;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerText = text;

    container.append(author, bubble);
    chatMessages.append(container);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

micBtn.addEventListener('click', () => {
    isMicEnabled = !isMicEnabled;
    myStream.getAudioTracks().forEach(track => track.enabled = isMicEnabled);
    toggleDockIconStatus(micBtn, isMicEnabled, '🎤', '🎙️❌');
    socket.emit('toggle-track', 'audio', isMicEnabled);
});

camBtn.addEventListener('click', () => {
    isCamEnabled = !isCamEnabled;
    myStream.getVideoTracks().forEach(track => track.enabled = isCamEnabled);
    toggleDockIconStatus(camBtn, isCamEnabled, '📷', '📹❌');
    socket.emit('toggle-track', 'video', isCamEnabled);
    updateLocalIndicators('video', isCamEnabled);
});

function toggleDockIconStatus(element, enabled, activeSymbol, inactiveSymbol) {
    if (enabled) {
        element.classList.remove('muted');
        element.innerText = activeSymbol;
    } else {
        element.classList.add('muted');
        element.innerText = inactiveSymbol;
    }
}

function updateLocalIndicators(type, enabled) {
    const localWrapper = document.getElementById('user-local');
    if (!localWrapper) return;
    if (type === 'video') {
        enabled ? localWrapper.classList.remove('video-muted') : localWrapper.classList.add('video-muted');
    }
}

function initiateCall(roomId) {
    myName = nameInput.value.trim() || 'Global Guest';
    currentRoomId = roomId;

    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
        myStream = stream;
        
        const myVideo = document.createElement('video');
        myVideo.muted = true; 
        addVideoStream(myVideo, stream, `${myName} (You)`, 'local');

        joinContainer.classList.add('hidden');
        videoInterface.classList.remove('hidden');
        roomTitle.innerText = roomId;
        window.location.hash = roomId;

        myPeer = new Peer();

        myPeer.on('open', userId => {
            socket.emit('join-room', roomId, userId, myName);
            participantList.add(userId);
            updateParticipantCount();
        });

        myPeer.on('call', call => {
            const callerName = call.metadata ? call.metadata.callerName : 'Guest';
            call.answer(stream); 
            const video = document.createElement('video');
            
            call.on('stream', userVideoStream => {
                if (!peerDOMWrappers[call.peer]) {
                    peerDOMWrappers[call.peer] = addVideoStream(video, userVideoStream, callerName, call.peer);
                    participantList.add(call.peer);
                    updateParticipantCount();
                }
            });
            peers[call.peer] = call;
        });

        socket.on('user-connected', (userId, userName) => {
            setTimeout(() => connectToNewUser(userId, stream, userName), 1000);
        });

        socket.on('receive-chat-message', (data) => {
            appendMessageBubble(data.text, data.senderName, 'remote');
        });

        socket.on('user-track-toggled', (userId, type, enabled) => {
            const wrapper = document.getElementById(`user-${userId}`);
            if (!wrapper) return;
            if (type === 'video') {
                enabled ? wrapper.classList.remove('video-muted') : wrapper.classList.add('video-muted');
            }
        });

    }).catch(() => {
        alert('Media Access Interrupted: Standard Audio/Video access permissions are mandatory.');
    });
}

socket.on('user-disconnected', userId => {
    if (peers[userId]) peers[userId].close();
    if (peerDOMWrappers[userId]) {
        peerDOMWrappers[userId].remove();
        delete peerDOMWrappers[userId];
    }
    participantList.delete(userId);
    updateParticipantCount();
});

function connectToNewUser(userId, stream, userName) {
    const call = myPeer.call(userId, stream, { metadata: { callerName: myName } });
    const video = document.createElement('video');
    
    call.on('stream', userVideoStream => {
        if (!peerDOMWrappers[userId]) {
            peerDOMWrappers[userId] = addVideoStream(video, userVideoStream, userName, userId);
            participantList.add(userId);
            updateParticipantCount();
        }
    });
    peers[userId] = call;
}

function addVideoStream(video, stream, name, userId) {
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => video.play());

    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = userId === 'local' ? 'user-local' : `user-${userId}`;

    const nameLabel = document.createElement('div');
    nameLabel.className = 'name-label';
    nameLabel.innerText = name;

    wrapper.append(video, nameLabel);
    videoGrid.append(wrapper);

    return wrapper;
}

function updateParticipantCount() {
    participantCount.innerText = `Participants: ${participantList.size}`;
}