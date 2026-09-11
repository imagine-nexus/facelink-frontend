const RENDER_SERVER = 'facelink-backend.onrender.com'; 

const socket = io(`https://${RENDER_SERVER}`, {
    transports: ['websocket'],
    withCredentials: true
});

// DOM Elements
const videoGrid = document.getElementById('video-grid');
const joinContainer = document.getElementById('join-container');
const videoInterface = document.getElementById('video-interface');
const roomInput = document.getElementById('room-input');
const nameInput = document.getElementById('name-input');
const roomTitle = document.getElementById('room-title');
const copyBtn = document.getElementById('copy-btn');
const waitingOverlay = document.getElementById('waiting-overlay');
const admissionPrompts = document.getElementById('admission-prompts');

// Controls
const micBtn = document.getElementById('mic-btn');
const camBtn = document.getElementById('cam-btn');
const shareBtn = document.getElementById('share-btn');
const leaveBtn = document.getElementById('leave-btn');
const participantCount = document.getElementById('participant-count');

// 3-Dots Dropdown Menu Items
const moreBtn = document.getElementById('more-btn');
const moreMenu = document.getElementById('more-menu');
const handBtn = document.getElementById('hand-btn');
const boardBtn = document.getElementById('board-btn');
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const muteAllBtn = document.getElementById('mute-all-btn');

// Panels
const chatPanel = document.getElementById('chat-panel');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessages = document.getElementById('chat-messages');

// State Variables
let myPeer;
let myStream;
let myName = '';
let currentRoomId = '';
let isMicEnabled = true;
let isCamEnabled = true;
let isHost = false;
let isHandRaised = false;
let isScreenSharing = false;

const peers = {};
const peerDOMWrappers = {};
let participantList = new Set();

if (window.location.hash) {
    roomInput.value = window.location.hash.substring(1);
}

// --- 3-Dots Menu Dropdown Interaction ---
moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreMenu.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
    if (!moreMenu.contains(e.target) && !moreBtn.contains(e.target)) {
        moreMenu.classList.add('hidden');
    }
});

document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
        moreMenu.classList.add('hidden');
    });
});

// --- Join & Waiting Room Logic ---
document.getElementById('create-btn').addEventListener('click', () => {
    const code = `${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 6)}`;
    myName = nameInput.value.trim() || 'Host';
    socket.emit('request-join', code, { name: myName });
});

document.getElementById('join-btn').addEventListener('click', () => {
    const roomId = roomInput.value.trim();
    if (!roomId) return alert('Please enter a meeting code');
    myName = nameInput.value.trim() || 'Guest';
    
    joinContainer.classList.add('hidden');
    waitingOverlay.classList.remove('hidden');
    socket.emit('request-join', roomId, { name: myName });
});

socket.on('admitted', (roomId, hostStatus) => {
    waitingOverlay.classList.add('hidden');
    if (hostStatus) {
        isHost = true;
        document.getElementById('host-badge').classList.remove('hidden');
        muteAllBtn.classList.remove('hidden');
    }
    initiateCall(roomId);
});

socket.on('join-request', (user) => {
    const card = document.createElement('div');
    card.className = 'admit-card';
    card.innerHTML = `<span><b>${user.name}</b> wants to join</span>`;
    
    const btn = document.createElement('button');
    btn.className = 'primary-btn admit-btn';
    btn.innerText = 'Admit';
    btn.onclick = () => {
        socket.emit('admit-user', user.socketId, currentRoomId);
        card.remove();
    };
    
    card.append(btn);
    admissionPrompts.append(card);
});

// --- Call Initialization ---
function initiateCall(roomId) {
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
            socket.emit('join-room', roomId, userId, myName, isHost);
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
        alert('Media permissions are required to participate in the meeting.');
    });
}

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

socket.on('user-disconnected', userId => {
    if (peers[userId]) peers[userId].close();
    if (peerDOMWrappers[userId]) {
        peerDOMWrappers[userId].remove();
        delete peerDOMWrappers[userId];
    }
    participantList.delete(userId);
    updateParticipantCount();
});

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

// --- Basic UI Controls ---
leaveBtn.addEventListener('click', () => window.location.reload());

copyBtn.addEventListener('click', () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#${currentRoomId}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML = "<span class='material-symbols-outlined' style='font-size:16px; vertical-align:middle; margin-right:4px;'>check</span> Copied!";
        setTimeout(() => copyBtn.innerHTML = originalHTML, 2000);
    });
});

chatToggleBtn.addEventListener('click', () => {
    chatPanel.classList.toggle('hidden');
    chatMessages.scrollTop = chatMessages.scrollHeight; 
});
closeChatBtn.addEventListener('click', () => chatPanel.classList.add('hidden'));

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
    toggleDockIconStatus(micBtn, isMicEnabled, 'mic', 'mic_off');
    socket.emit('toggle-track', 'audio', isMicEnabled);
});

camBtn.addEventListener('click', () => {
    isCamEnabled = !isCamEnabled;
    myStream.getVideoTracks().forEach(track => track.enabled = isCamEnabled);
    toggleDockIconStatus(camBtn, isCamEnabled, 'videocam', 'videocam_off');
    socket.emit('toggle-track', 'video', isCamEnabled);
    updateLocalIndicators('video', isCamEnabled);
});

function toggleDockIconStatus(element, enabled, activeSymbol, inactiveSymbol) {
    if (enabled) {
        element.classList.remove('muted');
        element.innerHTML = `<span class="material-symbols-outlined">${activeSymbol}</span>`;
    } else {
        element.classList.add('muted');
        element.innerHTML = `<span class="material-symbols-outlined">${inactiveSymbol}</span>`;
    }
}

function updateLocalIndicators(type, enabled) {
    const localWrapper = document.getElementById('user-local');
    if (!localWrapper) return;
    if (type === 'video') {
        enabled ? localWrapper.classList.remove('video-muted') : localWrapper.classList.add('video-muted');
    }
}

// --- Screen Sharing ---
shareBtn.addEventListener('click', async () => {
    if (!isScreenSharing) {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const videoTrack = screenStream.getVideoTracks()[0];
            
            Object.values(peers).forEach(call => {
                const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(videoTrack);
            });
            
            document.querySelector('#user-local video').srcObject = screenStream;
            isScreenSharing = true;
            shareBtn.classList.add('muted');

            videoTrack.onended = stopScreenShare;
        } catch (e) {
            console.error('Screen sharing canceled or denied');
        }
    } else {
        stopScreenShare();
    }
});

function stopScreenShare() {
    const videoTrack = myStream.getVideoTracks()[0];
    Object.values(peers).forEach(call => {
        const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
    });
    document.querySelector('#user-local video').srcObject = myStream;
    isScreenSharing = false;
    shareBtn.classList.remove('muted');
}

// --- Hand Raising ---
handBtn.addEventListener('click', () => {
    isHandRaised = !isHandRaised;
    socket.emit('raise-hand', isHandRaised);
    toggleHandUI('local', isHandRaised);
    isHandRaised ? handBtn.classList.add('muted') : handBtn.classList.remove('muted');
});

socket.on('user-hand-raised', (userId, raised) => toggleHandUI(userId, raised));

function toggleHandUI(userId, raised) {
    const wrapper = document.getElementById(userId === 'local' ? 'user-local' : `user-${userId}`);
    if (!wrapper) return;
    if (raised) {
        if (!document.getElementById(`hand-${userId}`)) {
            const icon = document.createElement('div');
            icon.className = 'hand-icon';
            icon.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">front_hand</span>';
            icon.id = `hand-${userId}`;
            wrapper.append(icon);
        }
    } else {
        const icon = document.getElementById(`hand-${userId}`);
        if (icon) icon.remove();
    }
}

// --- Host Controls (Force Mute All) ---
muteAllBtn.addEventListener('click', () => {
    if (isHost) socket.emit('mute-all');
});

socket.on('force-mute', () => {
    if (isMicEnabled) {
        isMicEnabled = false;
        myStream.getAudioTracks().forEach(track => track.enabled = false);
        micBtn.classList.add('muted');
        micBtn.innerHTML = '<span class="material-symbols-outlined">mic_off</span>';
        socket.emit('toggle-track', 'audio', false);
    }
});

// --- Collaborative Whiteboard ---
const canvas = document.getElementById('whiteboard-canvas');
const ctx = canvas.getContext('2d');
let drawing = false;

boardBtn.addEventListener('click', () => {
    const board = document.getElementById('whiteboard-container');
    board.classList.toggle('hidden');
    if (!board.classList.contains('hidden')) {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }
});

document.getElementById('close-board-btn').addEventListener('click', () => {
    document.getElementById('whiteboard-container').classList.add('hidden');
});

document.getElementById('clear-board-btn').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

canvas.addEventListener('mousedown', (e) => { drawing = true; draw(e); });
canvas.addEventListener('mouseup', () => { drawing = false; ctx.beginPath(); });
canvas.addEventListener('mousemove', draw);

function draw(e) {
    if (!drawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a73e8';

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);

    socket.emit('draw-line', { x, y, width: canvas.width, height: canvas.height });
}

socket.on('draw-line', (data) => {
    const remoteX = (data.x / data.width) * canvas.width;
    const remoteY = (data.y / data.height) * canvas.height;
    
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ea4335';
    ctx.lineTo(remoteX, remoteY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(remoteX, remoteY);
});