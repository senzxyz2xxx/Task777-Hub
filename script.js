import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCu0ls1s27IMAQyuMiUo9iVq0K6gNluDXI",
    authDomain: "task777-4ff59.firebaseapp.com",
    projectId: "task777-4ff59",
    storageBucket: "task777-4ff59.firebasestorage.app",
    messagingSenderId: "715058556919",
    appId: "1:715058556919:web:37a01e94289ae9589908f2",
    measurementId: "G-70C4QSXPW6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ===== State =====
let currentRoomId = "";
let myUsername = "";
let roomOwner = "";          // ← ใหม่: เก็บชื่อ owner ของห้อง
let dbTasksUnsubscribe = null;
let dbMembersUnsubscribe = null;
let assignments = [];
let localStatuses = {};
let activeFilter = "all";
let activeSubjectFilter = "all";
let activeSortOrder = "due";      // "due" | "added"
let isInitialLoad = true;
let dueSoonNotified = false;      // แจ้งเตือนงานใกล้ deadline แค่ครั้งเดียวต่อ session
let pendingIntent = null;
let pendingRoomCode = "";

// ===== DOM refs =====
const roomSelectionScreen = document.getElementById('room-selection-screen');
const authScreen = document.getElementById('auth-screen');
const mainAppScreen = document.getElementById('main-app-screen');
const roomCodeInput = document.getElementById('room-code-input');
const usernameInput = document.getElementById('username-input');
const currentRoomText = document.getElementById('current-room-text');
const activeMembersList = document.getElementById('active-members-list');
const assignmentsList = document.getElementById('assignments-list');
const taskModal = document.getElementById('task-modal');
const taskForm = document.getElementById('task-form');
const searchInput = document.getElementById('search-input');
const subjectTagsContainer = document.getElementById('subject-tags-container');
const toastContainer = document.getElementById('toast-container');

// ===== Bubble Notification =====
function showBubbleNotification(title, message, type = "info") {
    const icons = { info: "ℹ️", success: "✅", warning: "⚠️", danger: "🚨" };
    const bubble = document.createElement('div');
    bubble.className = `toast-bubble ${type}`;
    bubble.innerHTML = `
        <div class="toast-icon">${icons[type] || "🔔"}</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-desc">${message}</div>
        </div>
    `;
    toastContainer.appendChild(bubble);
    setTimeout(() => bubble.classList.add('show'), 50);
    setTimeout(() => {
        bubble.classList.remove('show');
        setTimeout(() => bubble.remove(), 300);
    }, 3500);
}

function showBubbleConfirm(title, message, onConfirm) {
    const bubble = document.createElement('div');
    bubble.className = 'toast-bubble warning confirm-bubble';
    bubble.innerHTML = `
        <div class="toast-icon">🗑️</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-desc">${message}</div>
            <div class="confirm-actions">
                <button class="confirm-yes">ยืนยัน</button>
                <button class="confirm-no">ยกเลิก</button>
            </div>
        </div>
    `;
    toastContainer.appendChild(bubble);
    setTimeout(() => bubble.classList.add('show'), 50);

    const close = () => {
        bubble.classList.remove('show');
        setTimeout(() => bubble.remove(), 300);
    };
    bubble.querySelector('.confirm-yes').addEventListener('click', () => { close(); onConfirm(); });
    bubble.querySelector('.confirm-no').addEventListener('click', close);
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    const codeBoxes = document.querySelectorAll('.code-box');
    codeBoxes.forEach((box, i) => {
        box.addEventListener('input', () => {
            const val = box.value.replace(/\D/g, '');
            box.value = val;
            if (val && i < codeBoxes.length - 1) codeBoxes[i + 1].focus();
            syncRoomCode();
        });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !box.value && i > 0) {
                codeBoxes[i - 1].focus();
                codeBoxes[i - 1].value = '';
                syncRoomCode();
            }
        });
        box.addEventListener('paste', (e) => {
            e.preventDefault();
            const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 4);
            paste.split('').forEach((ch, idx) => { if (codeBoxes[idx]) codeBoxes[idx].value = ch; });
            syncRoomCode();
            if (paste.length > 0) codeBoxes[Math.min(paste.length, 3)].focus();
        });
    });

    document.getElementById('join-room-btn').addEventListener('click', handleJoinClick);
    document.getElementById('create-room-btn').addEventListener('click', handleCreateClick);
    document.getElementById('leave-room-btn').addEventListener('click', leaveRoom);
    document.getElementById('copy-room-btn').addEventListener('click', copyRoomCode);
    document.getElementById('open-modal-btn').addEventListener('click', () => openModal('create'));
    document.getElementById('close-modal-btn').addEventListener('click', closeModal);
    taskForm.addEventListener('submit', saveAssignmentToServer);
    searchInput.addEventListener('input', renderUI);

    document.getElementById('auth-back-btn').addEventListener('click', goBackToSelection);
    document.getElementById('btn-choice-nopwd').addEventListener('click', () => setPasswordChoice(false));
    document.getElementById('btn-choice-haspwd').addEventListener('click', () => setPasswordChoice(true));
    document.getElementById('auth-confirm-create-btn').addEventListener('click', handleConfirmCreate);
    document.getElementById('auth-confirm-join-btn').addEventListener('click', handleConfirmJoin);

    document.querySelectorAll('.filter-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeFilter = e.target.getAttribute('data-filter');
            renderUI();
        });
    });

    document.querySelectorAll('.sort-tabs .sort-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.sort-tabs .sort-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeSortOrder = e.target.getAttribute('data-sort');
            renderUI();
        });
    });

    document.querySelectorAll('.qd-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const days = parseInt(chip.dataset.days);
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + days);
            const iso = d.toISOString().split('T')[0];
            document.getElementById('task-date').value = iso;
            document.querySelectorAll('.qd-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            updateDueHint(d);
        });
    });

    document.getElementById('task-date').addEventListener('input', () => {
        const val = document.getElementById('task-date').value;
        document.querySelectorAll('.qd-chip').forEach(c => c.classList.remove('active'));
        if (val) updateDueHint(new Date(val + 'T00:00:00'));
        else document.getElementById('due-hint').textContent = '';
    });

    const savedRoom = localStorage.getItem('task777_last_room');
    const savedName = localStorage.getItem('task777_my_username');
    if (savedName) usernameInput.value = savedName;
    if (savedRoom && savedName) { myUsername = savedName; enterRoom(savedRoom); }
});

function updateDueHint(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    const hint = document.getElementById('due-hint');
    if (!hint) return;
    if (diff < 0) hint.innerHTML = `<span class="hint-red">⚠️ เกินกำหนดไปแล้ว ${Math.abs(diff)} วัน</span>`;
    else if (diff === 0) hint.innerHTML = `<span class="hint-orange">⏳ ส่งวันนี้!</span>`;
    else if (diff <= 7) hint.innerHTML = `<span class="hint-orange">⏳ เหลืออีก ${diff} วัน</span>`;
    else hint.innerHTML = `<span class="hint-green">🗓️ เหลืออีก ${diff} วัน</span>`;
}

function syncRoomCode() {
    const boxes = document.querySelectorAll('.code-box');
    roomCodeInput.value = Array.from(boxes).map(b => b.value).join('');
}

// ===== Create / Join =====
function handleCreateClick() {
    const name = usernameInput.value.trim();
    if (!name) { showBubbleNotification("⚠️ ยังไม่ได้กรอกชื่อ", "กรุณากรอกชื่อเล่นของคุณก่อนสร้างห้องครับ", "warning"); return; }
    myUsername = name;
    localStorage.setItem('task777_my_username', name);
    const fourDigitCode = Math.floor(1000 + Math.random() * 9000).toString();
    pendingRoomCode = fourDigitCode;
    pendingIntent = "create";
    showAuthScreen_Create();
}

async function handleJoinClick() {
    const name = usernameInput.value.trim();
    syncRoomCode();
    const code = roomCodeInput.value.trim();
    if (!name) { showBubbleNotification("⚠️ ยังไม่ได้กรอกชื่อ", "กรุณาระบุชื่อเล่นของคุณก่อนครับ", "warning"); return; }
    if (code.length !== 4 || isNaN(code)) { showBubbleNotification("⚠️ รหัสห้องไม่ถูกต้อง", "รหัสห้องต้องเป็นตัวเลข 4 หลักเท่านั้นครับ", "warning"); return; }
    myUsername = name;
    localStorage.setItem('task777_my_username', name);
    pendingRoomCode = code;
    pendingIntent = "join";
    try {
        const roomMeta = await getDoc(doc(db, "rooms", code, "meta", "settings"));
        if (roomMeta.exists() && roomMeta.data().hasPassword) {
            showAuthScreen_Join();
        } else {
            enterRoom(code);
        }
    } catch (err) {
        console.error("ตรวจสอบห้องไม่ได้:", err);
        enterRoom(code);
    }
}

// ===== Auth Screen =====
function showAuthScreen_Create() {
    document.getElementById('auth-title').textContent = ' ตั้งค่าห้องใหม่';
    document.getElementById('auth-subtitle').textContent = `รหัสห้องของคุณคือ: ${pendingRoomCode}`;
    document.getElementById('auth-create-flow').classList.remove('hidden');
    document.getElementById('auth-join-flow').classList.add('hidden');
    setPasswordChoice(false);
    roomSelectionScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
}

function showAuthScreen_Join() {
    document.getElementById('auth-title').textContent = '🔒 ห้องนี้ล็อคอยู่';
    document.getElementById('auth-subtitle').textContent = `ห้อง ${pendingRoomCode} ต้องการรหัสผ่านเพื่อเข้า`;
    document.getElementById('auth-create-flow').classList.add('hidden');
    document.getElementById('auth-join-flow').classList.remove('hidden');
    document.getElementById('auth-input-password').value = '';
    roomSelectionScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
}

function setPasswordChoice(usePassword) {
    const nopwdBtn = document.getElementById('btn-choice-nopwd');
    const haspwdBtn = document.getElementById('btn-choice-haspwd');
    const wrapper = document.getElementById('auth-custom-pwd-wrapper');
    if (usePassword) {
        haspwdBtn.classList.add('active'); nopwdBtn.classList.remove('active');
        wrapper.classList.remove('hidden');
    } else {
        nopwdBtn.classList.add('active'); haspwdBtn.classList.remove('active');
        wrapper.classList.add('hidden');
        document.getElementById('auth-new-password').value = '';
    }
}

async function handleConfirmCreate() {
    const usePassword = document.getElementById('btn-choice-haspwd').classList.contains('active');
    const pwd = document.getElementById('auth-new-password').value.trim();
    if (usePassword && !pwd) {
        showBubbleNotification("⚠️ ยังไม่ได้กำหนดรหัสผ่าน", "กรุณากรอกรหัสผ่าน หรือเลือก 'ไม่ใช้รหัสผ่าน'", "warning");
        return;
    }
    try {
        const settingsRef = doc(db, "rooms", pendingRoomCode, "meta", "settings");
        // บันทึก owner พร้อมกับ settings
        await setDoc(settingsRef, usePassword
            ? { hasPassword: true, password: pwd, owner: myUsername }
            : { hasPassword: false, owner: myUsername }
        );
    } catch (err) { console.error("บันทึก settings ไม่ได้:", err); }
    authScreen.classList.add('hidden');
    enterRoom(pendingRoomCode);
    setTimeout(() => showBubbleNotification("🎉 สร้างห้องสำเร็จ!", `คุณเป็น Owner ของห้อง ${pendingRoomCode}`, "success"), 500);
}

async function handleConfirmJoin() {
    const inputPwd = document.getElementById('auth-input-password').value.trim();
    if (!inputPwd) { showBubbleNotification("⚠️ ยังไม่ได้กรอกรหัสผ่าน", "กรุณากรอกรหัสผ่าน", "warning"); return; }
    try {
        const roomMeta = await getDoc(doc(db, "rooms", pendingRoomCode, "meta", "settings"));
        if (roomMeta.exists() && roomMeta.data().password !== inputPwd) {
            showBubbleNotification("❌ รหัสผ่านไม่ถูกต้อง", "กรุณาลองใหม่อีกครั้ง", "danger");
            document.getElementById('auth-input-password').value = '';
            document.getElementById('auth-input-password').focus();
            return;
        }
    } catch (err) { console.error("ตรวจรหัสผ่านไม่ได้:", err); }
    authScreen.classList.add('hidden');
    enterRoom(pendingRoomCode);
}

function goBackToSelection() {
    authScreen.classList.add('hidden');
    roomSelectionScreen.classList.remove('hidden');
    pendingIntent = null;
    pendingRoomCode = "";
}

// ===== Enter Room =====
async function enterRoom(roomId) {
    currentRoomId = roomId;
    localStorage.setItem('task777_last_room', roomId);
    isInitialLoad = true;
    localStatuses = JSON.parse(localStorage.getItem(`task777_statuses_${currentRoomId}`)) || {};
    currentRoomText.textContent = currentRoomId;
    roomSelectionScreen.classList.add('hidden');
    authScreen.classList.add('hidden');
    mainAppScreen.classList.remove('hidden');

    // โหลด owner จาก settings
    try {
        const settingsSnap = await getDoc(doc(db, "rooms", roomId, "meta", "settings"));
        if (settingsSnap.exists()) {
            roomOwner = settingsSnap.data().owner || "";
        } else {
            roomOwner = "";
        }
    } catch (err) { roomOwner = ""; }

    // อัปเดต owner badge ใน app bar
    updateOwnerBadge();

    try {
        await setDoc(doc(db, "rooms", currentRoomId, "members", myUsername), { name: myUsername, onlineAt: new Date() });
    } catch (err) { console.error("Firebase Error:", err); }

    if (dbTasksUnsubscribe) dbTasksUnsubscribe();
    if (dbMembersUnsubscribe) dbMembersUnsubscribe();

    dbTasksUnsubscribe = onSnapshot(collection(db, "rooms", currentRoomId, "assignments"), (snapshot) => {
        const previousLength = assignments.length;
        const freshList = [];
        snapshot.forEach((d) => { freshList.push({ id: d.id, ...d.data() }); });
        if (!isInitialLoad) {
            snapshot.docChanges().forEach((change) => {
                const data = change.doc.data();
                if (change.type === "added" && freshList.length > previousLength)
                    showBubbleNotification("📝 การบ้านเข้าใหม่!", `วิชา ${data.subject} โดย ${data.createdBy || 'เพื่อนในห้อง'}`, "success");
                if (change.type === "modified")
                    showBubbleNotification("✏️ ปรับปรุงงาน", `วิชา ${data.subject} แก้ไขโดย ${data.createdBy}`, "warning");
                if (change.type === "removed")
                    showBubbleNotification("🗑️ ลบการบ้านออกแล้ว", "การบ้านถูกลบออกจากกลุ่ม", "danger");
            });
        }
        assignments = freshList;
        isInitialLoad = false;
        checkDueSoonNotification();
        renderUI();
    }, () => {
        showBubbleNotification("❌ ข้อผิดพลาดคลาวด์", "โปรดตรวจสอบ Rules ใน Firebase", "danger");
    });

    dbMembersUnsubscribe = onSnapshot(collection(db, "rooms", currentRoomId, "members"), (snapshot) => {
        // ตรวจว่าตัวเองถูก kick (doc ของเราหายออกจาก collection)
        const memberNames = new Set();
        snapshot.forEach(d => memberNames.add(d.id));
        if (!memberNames.has(myUsername) && currentRoomId) {
            showKickedOverlay();
            return;
        }
        renderMemberChips(snapshot);
    });
}

// ===== Owner Badge =====
function updateOwnerBadge() {
    const ownerBadge = document.getElementById('owner-badge');
    if (!ownerBadge) return;
    if (myUsername === roomOwner && roomOwner) {
        ownerBadge.textContent = '👑 Owner';
        ownerBadge.classList.remove('hidden');
    } else {
        ownerBadge.classList.add('hidden');
    }
}

// ===== Render Member Chips (แยก function ให้ชัด) =====
function renderMemberChips(snapshot) {
    activeMembersList.innerHTML = '';
    const isOwner = myUsername === roomOwner;

    snapshot.forEach((d) => {
        const member = d.data();
        const isMe = member.name === myUsername;
        const isMemberOwner = member.name === roomOwner;

        const chip = document.createElement('div');
        chip.className = 'member-chip-wrap';

        let label = member.name;
        if (isMe) label += ' (คุณ)';

        let ownerTag = isMemberOwner
            ? `<span class="owner-tag">owner</span>`
            : '';

        // ปุ่ม kick — แสดงเฉพาะเมื่อ: เป็น owner, ไม่ใช่ตัวเอง, เป้าหมายไม่ใช่ owner
        let kickBtn = '';
        if (isOwner && !isMe && !isMemberOwner) {
            kickBtn = `<button class="kick-btn" title="Kick ${escapeHTML(member.name)}" onclick="kickMember('${escapeHTML(member.name)}')">kick</button>`;
        }

        chip.innerHTML = `
            <span class="member-chip ${isMemberOwner ? 'owner-chip' : ''}">
                ${ownerTag}${escapeHTML(label)}
            </span>
            ${kickBtn}
        `;
        activeMembersList.appendChild(chip);
    });
}

// ===== Kick Member =====
window.kickMember = function(targetName) {
    if (myUsername !== roomOwner) return;
    showBubbleConfirm(
        `Kick ${targetName}?`,
        `${targetName} จะถูกลบออกจากห้องทันที`,
        async () => {
            try {
                await deleteDoc(doc(db, "rooms", currentRoomId, "members", targetName));
                showBubbleNotification("👢 Kick สำเร็จ", `${targetName} ถูกนำออกจากห้องแล้ว`, "warning");
            } catch (err) {
                showBubbleNotification("❌ Kick ไม่สำเร็จ", "โปรดลองใหม่อีกครั้ง", "danger");
            }
        }
    );
}

// ===== Kicked Overlay =====
function showKickedOverlay() {
    // unsubscribe ทันที ป้องกัน loop
    if (dbTasksUnsubscribe) { dbTasksUnsubscribe(); dbTasksUnsubscribe = null; }
    if (dbMembersUnsubscribe) { dbMembersUnsubscribe(); dbMembersUnsubscribe = null; }

    const overlay = document.createElement('div');
    overlay.id = 'kicked-overlay';
    overlay.innerHTML = `
        <div class="kicked-box">
            <div class="kicked-icon">🚫</div>
            <h2 class="kicked-title">คุณถูก Kick ออกจากห้อง</h2>
            <p class="kicked-desc">หัวห้องได้นำคุณออกจากห้อง ${currentRoomId} แล้ว</p>
            <button class="btn-create-room" onclick="dismissKick()" style="margin-top: 1.5rem; max-width: 240px;">กลับหน้าแรก</button>
        </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('show'), 50);
}

window.dismissKick = function() {
    const overlay = document.getElementById('kicked-overlay');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 300);
    }
    // reset state และกลับหน้าแรก
    localStorage.removeItem('task777_last_room');
    currentRoomId = "";
    roomOwner = "";
    dueSoonNotified = false;
    assignments = [];
    localStatuses = {};
    mainAppScreen.classList.add('hidden');
    roomSelectionScreen.classList.remove('hidden');
    document.querySelectorAll('.code-box').forEach(b => b.value = '');
    roomCodeInput.value = '';
}

// ===== Leave Room =====
async function leaveRoom() {
    try { await deleteDoc(doc(db, "rooms", currentRoomId, "members", myUsername)); } catch (e) {}
    if (dbTasksUnsubscribe) dbTasksUnsubscribe();
    if (dbMembersUnsubscribe) dbMembersUnsubscribe();
    localStorage.removeItem('task777_last_room');
    currentRoomId = "";
    roomOwner = "";
    dueSoonNotified = false;
    assignments = [];
    mainAppScreen.classList.add('hidden');
    roomSelectionScreen.classList.remove('hidden');
    document.querySelectorAll('.code-box').forEach(b => b.value = '');
    roomCodeInput.value = '';
}

function copyRoomCode() {
    navigator.clipboard.writeText(currentRoomId).then(() => {
        showBubbleNotification("📋 คัดลอกแล้ว!", `รหัสห้อง ${currentRoomId} อยู่ในคลิปบอร์ดแล้ว`, "info");
    });
}

// ===== Due date =====
function parseDateLocal(dateString) {
    // "YYYY-MM-DD" → parse as local time ป้องกัน UTC offset ทำให้วันเลื่อน
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function calculateDueInfo(dateString) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = parseDateLocal(dateString);
    const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { color: "red", text: `⚠️ เกินกำหนด (${Math.abs(diffDays)} วัน)` };
    if (diffDays <= 7) return { color: "orange", text: `⏳ เหลืออีก ${diffDays} วัน` };
    return { color: "green", text: `🗓️ อีก ${diffDays} วัน` };
}

window.changePersonalStatus = function (taskId, newStatus) {
    localStatuses[taskId] = newStatus;
    localStorage.setItem(`task777_statuses_${currentRoomId}`, JSON.stringify(localStatuses));
    renderUI();
}

// ===== Modal =====
function openModal(mode, id = null) {
    taskForm.reset();
    document.querySelectorAll('.qd-chip').forEach(c => c.classList.remove('active'));
    const hint = document.getElementById('due-hint');
    if (hint) hint.innerHTML = '';

    if (mode === 'create') {
        document.getElementById('modal-title').textContent = 'เพิ่มการบ้านเข้าห้องส่วนกลาง';
        document.getElementById('task-id').value = '';
    } else {
        document.getElementById('modal-title').textContent = 'แก้ไขรายละเอียดการบ้าน';
        const task = assignments.find(t => t.id === id);
        if (task) {
            document.getElementById('task-id').value = task.id;
            document.getElementById('task-subject').value = task.subject;
            document.getElementById('task-title').value = task.title;
            document.getElementById('task-details').value = task.details;
            document.getElementById('task-date').value = task.dueDate;
            if (task.dueDate) updateDueHint(new Date(task.dueDate + 'T00:00:00'));
        }
    }
    taskModal.classList.add('active');
}

function closeModal() { taskModal.classList.remove('active'); }

async function saveAssignmentToServer(e) {
    e.preventDefault();
    const id = document.getElementById('task-id').value || Date.now().toString();
    const subject = document.getElementById('task-subject').value.trim();
    const title = document.getElementById('task-title').value.trim();
    const details = document.getElementById('task-details').value.trim();
    const dueDate = document.getElementById('task-date').value;
    try {
        await setDoc(doc(db, "rooms", currentRoomId, "assignments", id), {
            id, subject, title, details, dueDate,
            createdBy: myUsername, updatedAt: new Date()
        }, { merge: true });
        closeModal();
    } catch (error) {
        showBubbleNotification("❌ เซฟไม่สำเร็จ", "โปรดตรวจสอบ Rules ใน Firebase", "danger");
        console.error(error);
    }
}

window.deleteAssignmentFromServer = function (id) {
    showBubbleConfirm(
        "ลบการบ้านใบนี้?",
        "เพื่อนทุกคนในห้องจะไม่เห็นงานนี้อีกต่อไป",
        async () => {
            await deleteDoc(doc(db, "rooms", currentRoomId, "assignments", id));
        }
    );
}

window.triggerEditModal = function (id) { openModal('edit', id); }

// ===== Due Soon Notification =====
function checkDueSoonNotification() {
    if (dueSoonNotified) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const urgent = assignments.filter(task => {
        const s = localStatuses[task.id] || "todo";
        if (s === "submitted") return false;
        const due = new Date(task.dueDate); due.setHours(0, 0, 0, 0);
        const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
        return diff >= 0 && diff <= 2;
    });
    if (urgent.length > 0) {
        dueSoonNotified = true;
        setTimeout(() => {
            showBubbleNotification(
                `⏰ มีงานด่วน ${urgent.length} ชิ้น!`,
                urgent.map(t => `• ${t.subject}: ${t.title}`).slice(0, 3).join('\n'),
                "danger"
            );
        }, 800);
    }
}

// ===== Render =====
function renderUI() {
    const searchQuery = searchInput.value.toLowerCase();
    assignmentsList.innerHTML = '';
    let todoCount = 0, finishedCount = 0, submittedCount = 0;
    const uniqueSubjects = new Set();
    assignments.forEach(t => uniqueSubjects.add(t.subject));
    renderSubjectTags(Array.from(uniqueSubjects));
    assignments.forEach(task => {
        const s = localStatuses[task.id] || "todo";
        if (s === "todo") todoCount++;
        if (s === "finished") finishedCount++;
        if (s === "submitted") submittedCount++;
    });
    document.getElementById('stat-total').textContent = assignments.length;
    document.getElementById('stat-todo').textContent = todoCount;
    document.getElementById('stat-finished').textContent = finishedCount;
    document.getElementById('stat-submitted').textContent = submittedCount;

    const filteredTasks = assignments.filter(task => {
        const s = localStatuses[task.id] || "todo";
        return (task.subject.toLowerCase().includes(searchQuery) || task.title.toLowerCase().includes(searchQuery))
            && (activeFilter === "all" || s === activeFilter)
            && (activeSubjectFilter === "all" || task.subject === activeSubjectFilter);
    });

    // ===== Sort =====
    filteredTasks.sort((a, b) => {
        if (activeSortOrder === "due") {
            const da = a.dueDate ? parseDateLocal(a.dueDate) : new Date("9999-12-31");
            const db_ = b.dueDate ? parseDateLocal(b.dueDate) : new Date("9999-12-31");
            return da - db_;
        } else {
            // "added" — ใหม่สุดขึ้นก่อน (descending)
            return Number(b.id) - Number(a.id);
        }
    });

    const isOwner = myUsername === roomOwner;

    filteredTasks.forEach(task => {
        const dueInfo = calculateDueInfo(task.dueDate);
        const currentStatus = localStatuses[task.id] || "todo";
        const isTaskCreatorOwner = task.createdBy === roomOwner;
        // ===== Edit protection: แก้/ลบได้เฉพาะคนสร้าง หรือ owner =====
        const canEdit = myUsername === task.createdBy || isOwner;

        const card = document.createElement('div');
        card.className = `task-card glow-${dueInfo.color}`;
        card.innerHTML = `
            <div class="card-top">
                <span class="sbj-badge">${escapeHTML(task.subject)}</span>
                <span class="due-lbl ${dueInfo.color}">${dueInfo.text}</span>
            </div>
            <div class="card-mid">
                <h3>${escapeHTML(task.title)}</h3>
                <p>${escapeHTML(task.details || 'ไม่มีรายละเอียดระบุไว้')}</p>
                <span class="creator-stamp">
                    👤 ${escapeHTML(task.createdBy || 'เพื่อนร่วมห้อง')}
                    ${isTaskCreatorOwner ? '<span class="owner-tag-inline">owner</span>' : ''}
                </span>
            </div>
            <div class="card-bot">
                <div class="status-grid">
                    <button class="st-btn ${currentStatus === 'todo' ? 'active' : ''}" onclick="changePersonalStatus('${task.id}', 'todo')">To Do</button>
                    <button class="st-btn ${currentStatus === 'finished' ? 'active' : ''}" onclick="changePersonalStatus('${task.id}', 'finished')">Finished</button>
                    <button class="st-btn ${currentStatus === 'submitted' ? 'active' : ''}" onclick="changePersonalStatus('${task.id}', 'submitted')">Submitted</button>
                </div>
                <div class="action-row">
                    ${canEdit ? `<button class="btn-edit" onclick="triggerEditModal('${task.id}')">แก้ไขงาน</button>` : `<span class="no-edit-label">เพิ่มโดย ${escapeHTML(task.createdBy || '?')}</span>`}
                    ${canEdit ? `<button class="btn-del" onclick="deleteAssignmentFromServer('${task.id}')">ลบ</button>` : ''}
                </div>
            </div>
        `;
        assignmentsList.appendChild(card);
    });

    if (filteredTasks.length === 0) {
        assignmentsList.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:4rem 0; font-size: 0.85rem; letter-spacing: 0.3px;">ไม่มีภารกิจการบ้านค้างอยู่ในหมวดหมู่นี้ครับ</p>`;
    }
}

function renderSubjectTags(subjects) {
    subjectTagsContainer.innerHTML = '';
    if (subjects.length === 0) return;
    const allTag = document.createElement('button');
    allTag.className = `tag ${activeSubjectFilter === 'all' ? 'active' : ''}`;
    allTag.textContent = "🔍 ทุกวิชา";
    allTag.addEventListener('click', () => { activeSubjectFilter = "all"; renderUI(); });
    subjectTagsContainer.appendChild(allTag);
    subjects.forEach(sub => {
        const tag = document.createElement('button');
        tag.className = `tag ${activeSubjectFilter === sub ? 'active' : ''}`;
        tag.textContent = sub;
        tag.addEventListener('click', () => { activeSubjectFilter = sub; renderUI(); });
        subjectTagsContainer.appendChild(tag);
    });
}

function escapeHTML(str) {
    return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}
