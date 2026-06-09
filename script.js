import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocs, addDoc, query, orderBy, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// ================================================================
// 🔥 FIREBASE CONFIG
// ================================================================

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

// ================================================================
// 📦 STATE — ตัวแปรที่ใช้ทั่วทั้งแอป
// ================================================================

let currentRoomId = "";
let myUsername = "";
let roomOwner = "";
let dbTasksUnsubscribe = null;
let dbMembersUnsubscribe = null;
let assignments = [];
let localStatuses = {};
let activeFilter = "all";
let activeSubjectFilter = "all";
let activeSortOrder = "due";
let isInitialLoad = true;
let dueSoonNotified = false;
let pendingIntent = null;
let pendingRoomCode = "";
let isLeavingVoluntarily = false;

// comment panel state
let commentUnsubscribe = null;
let globalOnlineUnsubscribe = null; // เพิ่มต่อจาก commentUnsubscribe
let currentCommentTaskId = null;

// ================================================================
// 🖥️ DOM REFS — อ้างอิง element ที่ใช้บ่อย
// ================================================================

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

// ================================================================
// 🔔 TOAST NOTIFICATIONS — แจ้งเตือนแบบ bubble มุมจอ
// ================================================================

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

function showBubbleConfirm(title, message, onConfirm, confirmLabel = "ยืนยัน") {
    const bubble = document.createElement('div');
    bubble.className = 'toast-bubble warning confirm-bubble';
    bubble.innerHTML = `
        <div class="toast-icon">🗑️</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-desc">${message}</div>
            <div class="confirm-actions">
                <button class="confirm-yes">${confirmLabel}</button>
                <button class="confirm-no">ยกเลิก</button>
            </div>
        </div>
    `;
    toastContainer.appendChild(bubble);
    setTimeout(() => bubble.classList.add('show'), 50);
    const close = () => { bubble.classList.remove('show'); setTimeout(() => bubble.remove(), 300); };
    bubble.querySelector('.confirm-yes').addEventListener('click', () => { close(); onConfirm(); });
    bubble.querySelector('.confirm-no').addEventListener('click', close);
}

// ================================================================
// 🚀 INIT — รันตอน DOMContentLoaded ผูก event listeners ทั้งหมด
// ================================================================

document.addEventListener('DOMContentLoaded', () => {

    // --- Code boxes (4 ช่อง) ---
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

    // --- Buttons หน้า room selection / auth ---
    document.getElementById('join-room-btn').addEventListener('click', handleJoinClick);
    document.getElementById('create-room-btn').addEventListener('click', handleCreateClick);
    document.getElementById('auth-back-btn').addEventListener('click', goBackToSelection);
    document.getElementById('btn-choice-nopwd').addEventListener('click', () => setPasswordChoice(false));
    document.getElementById('btn-choice-haspwd').addEventListener('click', () => setPasswordChoice(true));
    document.getElementById('auth-confirm-create-btn').addEventListener('click', handleConfirmCreate);
    document.getElementById('auth-confirm-join-btn').addEventListener('click', handleConfirmJoin);

    // --- Buttons หน้า main app ---
    document.getElementById('leave-room-btn').addEventListener('click', handleLeaveClick);
    document.getElementById('copy-room-btn').addEventListener('click', copyRoomCode);
    document.getElementById('share-room-btn')?.addEventListener('click', shareRoomLink);
    document.getElementById('open-modal-btn').addEventListener('click', () => openModal('create'));

    // --- Task modal ---
    document.getElementById('close-modal-btn').addEventListener('click', closeModal);
    taskForm.addEventListener('submit', saveAssignmentToServer);

    // --- Search ---
    searchInput.addEventListener('input', renderUI);

    // --- Filter tabs (all / todo / finished / submitted) ---
    document.querySelectorAll('.filter-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeFilter = e.target.getAttribute('data-filter');
            renderUI();
        });
    });

    // --- Sort tabs (due date / newest) ---
    document.querySelectorAll('.sort-tabs .sort-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.sort-tabs .sort-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeSortOrder = e.target.getAttribute('data-sort');
            renderUI();
        });
    });

    // --- Quick-date chips ใน modal ---
    document.querySelectorAll('.qd-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const days = parseInt(chip.dataset.days);
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + days);
            const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            document.getElementById('task-date').value = iso;
            document.querySelectorAll('.qd-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            updateDueHint(d);
        });
    });

    document.getElementById('task-date').addEventListener('input', () => {
        const val = document.getElementById('task-date').value;
        document.querySelectorAll('.qd-chip').forEach(c => c.classList.remove('active'));
        if (val) updateDueHint(parseDateLocal(val));
        else document.getElementById('due-hint').textContent = '';
    });

    // --- Comment panel ---
    document.getElementById('close-comment-btn')?.addEventListener('click', closeCommentPanel);
    document.getElementById('comment-submit-btn')?.addEventListener('click', submitComment);
    document.getElementById('comment-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(); }
    });

    // --- Restore session / URL params ---
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    const savedRoom = localStorage.getItem('task777_last_room');
    const savedName = localStorage.getItem('task777_my_username');
    if (savedName) usernameInput.value = savedName;

    if (roomFromUrl) {
        roomFromUrl.split('').forEach((ch, idx) => {
            const boxes = document.querySelectorAll('.code-box');
            if (boxes[idx]) boxes[idx].value = ch;
        });
        syncRoomCode();
        showBubbleNotification("🔗 ลิงก์เชิญ", `กรอกชื่อแล้วกด เข้าร่วมห้อง ${roomFromUrl} ได้เลยครับ`, "info");
    } else if (savedRoom && savedName) {
        myUsername = savedName;
        restoreRoomSession(savedRoom);
    }

    // --- Global online counter ---
globalOnlineUnsubscribe = onSnapshot(collection(db, "globalOnline"), (snapshot) => {
    const el = document.getElementById('global-online-count');
    if (el) el.textContent = snapshot.size;
});

}); // end DOMContentLoaded

// ================================================================
// 🔄 SESSION RESTORE — ตรวจห้องก่อน restore (ป้องกันห้องถูกลบ)
// ================================================================

async function restoreRoomSession(roomId) {
    try {
        const snap = await getDoc(doc(db, "rooms", roomId, "meta", "settings"));
        if (!snap.exists()) {
            localStorage.removeItem('task777_last_room');
            showBubbleNotification("ℹ️ ห้องเดิมหายไปแล้ว", "ห้องที่เคยใช้ถูกลบหรือไม่มีอยู่แล้ว กรุณาเข้าห้องใหม่", "warning");
            return;
        }
        enterRoom(roomId);
    } catch (err) {
        console.error("restore session error:", err);
        localStorage.removeItem('task777_last_room');
    }
}

// ================================================================
// 🔐 AUTH SCREEN — สร้าง/เข้าห้อง + ตั้งรหัสผ่าน
// ================================================================

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
        if (!roomMeta.exists()) { showRoomNotFoundOverlay(code); return; }
        roomMeta.data().hasPassword ? showAuthScreen_Join() : enterRoom(code);
    } catch (err) {
        console.error("ตรวจสอบห้องไม่ได้:", err);
        showBubbleNotification("❌ ข้อผิดพลาด", "ไม่สามารถตรวจสอบห้องได้ โปรดลองใหม่อีกครั้ง", "danger");
    }
}

function showAuthScreen_Create() {
    document.getElementById('auth-title').textContent = 'ตั้งค่าห้องใหม่';
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
    document.getElementById('btn-choice-haspwd').classList.toggle('active', usePassword);
    document.getElementById('btn-choice-nopwd').classList.toggle('active', !usePassword);
    document.getElementById('auth-custom-pwd-wrapper').classList.toggle('hidden', !usePassword);
    if (!usePassword) document.getElementById('auth-new-password').value = '';
}

async function handleConfirmCreate() {
    const usePassword = document.getElementById('btn-choice-haspwd').classList.contains('active');
    const pwd = document.getElementById('auth-new-password').value.trim();
    if (usePassword && !pwd) { showBubbleNotification("⚠️ ยังไม่ได้กำหนดรหัสผ่าน", "กรุณากรอกรหัสผ่าน หรือเลือก 'ไม่ใช้รหัสผ่าน'", "warning"); return; }
    try {
        const hashed = usePassword ? await hashPassword(pwd) : null;
        await setDoc(doc(db, "rooms", pendingRoomCode, "meta", "settings"), usePassword
            ? { hasPassword: true, password: hashed, owner: myUsername, lastActivity: new Date() }
            : { hasPassword: false, owner: myUsername, lastActivity: new Date() }
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
        const inputHashed = await hashPassword(inputPwd);
        if (roomMeta.exists() && roomMeta.data().password !== inputHashed) {
            showBubbleNotification("❌ รหัสผ่านไม่ถูกต้อง", "กรุณาลองใหม่อีกครั้ง", "danger");
            const field = document.getElementById('auth-input-password');
            field.value = ''; field.focus();
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

// --- Room not found overlay ---
function showRoomNotFoundOverlay(code) {
    const existing = document.getElementById('room-not-found-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'room-not-found-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(100,60,60,0.35);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1.5rem;';
    overlay.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);padding:2.5rem 2rem;max-width:340px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(160,80,80,0.18);">
            <div style="font-size:3rem;margin-bottom:1rem;line-height:1;">❌</div>
            <h2 style="font-size:1.15rem;font-weight:600;color:var(--text);margin-bottom:0.65rem;line-height:1.4;">ไม่พบห้องนี้</h2>
            <p style="font-size:0.85rem;color:var(--text-2);line-height:1.7;margin-bottom:1.5rem;">รหัสห้อง <strong>${escapeHTML(code)}</strong> ไม่มีอยู่ในระบบ<br>กรุณาตรวจสอบรหัสอีกครั้งครับ</p>
            <button onclick="dismissRoomNotFound()" class="btn-create-room" style="max-width:200px;">ตกลง</button>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.2s';
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

window.dismissRoomNotFound = function() {
    const overlay = document.getElementById('room-not-found-overlay');
    if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 200); }
    roomSelectionScreen.classList.remove('hidden');
    authScreen.classList.add('hidden');
    mainAppScreen.classList.add('hidden');
    document.querySelectorAll('.code-box').forEach(b => b.value = '');
    roomCodeInput.value = '';
}

// ================================================================
// 🏠 ROOM — เข้าห้อง, ออกห้อง, ลบห้อง, kick
// ================================================================

async function enterRoom(roomId) {
    currentRoomId = roomId;
    localStorage.setItem('task777_last_room', roomId);
    isInitialLoad = true;
    localStatuses = JSON.parse(localStorage.getItem(`task777_statuses_${currentRoomId}`)) || {};
    currentRoomText.textContent = currentRoomId;
    roomSelectionScreen.classList.add('hidden');
    authScreen.classList.add('hidden');
    mainAppScreen.classList.remove('hidden');

    try {
        const settingsSnap = await getDoc(doc(db, "rooms", roomId, "meta", "settings"));
        roomOwner = settingsSnap.exists() ? settingsSnap.data().owner || "" : "";
    } catch { roomOwner = ""; }

    updateOwnerBadge();
    // เพิ่มตัวเองใน globalOnline
try {
    await setDoc(doc(db, "globalOnline", myUsername), { name: myUsername, onlineAt: new Date() });
} catch (err) { console.error("globalOnline error:", err); }

    try {
        await setDoc(doc(db, "rooms", currentRoomId, "members", myUsername), { name: myUsername, onlineAt: new Date() });
        await setDoc(doc(db, "rooms", currentRoomId, "meta", "settings"), { lastActivity: new Date() }, { merge: true });
    } catch (err) { console.error("Firebase Error:", err); }

    // ยกเลิก listener เก่าก่อนเปิดใหม่
    if (dbTasksUnsubscribe) dbTasksUnsubscribe();
    if (dbMembersUnsubscribe) dbMembersUnsubscribe();

    // --- Listener: tasks ---
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

    // --- Listener: members ---
    dbMembersUnsubscribe = onSnapshot(collection(db, "rooms", currentRoomId, "members"), (snapshot) => {
        const memberNames = new Set();
        snapshot.forEach(d => memberNames.add(d.id));
        if (!memberNames.has(myUsername) && currentRoomId && !isLeavingVoluntarily) {
            showKickedOverlay();
            return;
        }
        renderMemberChips(snapshot);
    });
}

function handleLeaveClick() {
    if (myUsername === roomOwner) {
        showOwnerLeaveDialog();
    } else {
        showBubbleConfirm("ออกจากห้องนี้?", "ข้อมูลการบ้านยังคงอยู่สำหรับสมาชิกคนอื่น", () => leaveRoom());
    }
}

async function leaveRoom() {
    isLeavingVoluntarily = true;
    if (dbTasksUnsubscribe) dbTasksUnsubscribe();
    if (dbMembersUnsubscribe) dbMembersUnsubscribe();
    closeCommentPanel();
    try { await deleteDoc(doc(db, "globalOnline", myUsername)); } catch {}
    try { await deleteDoc(doc(db, "rooms", currentRoomId, "members", myUsername)); } catch {}
    localStorage.removeItem('task777_last_room');
    const leftRoom = currentRoomId;
    currentRoomId = ""; roomOwner = ""; dueSoonNotified = false; assignments = [];
    isLeavingVoluntarily = false;
    mainAppScreen.classList.add('hidden');
    roomSelectionScreen.classList.remove('hidden');
    document.querySelectorAll('.code-box').forEach(b => b.value = '');
    roomCodeInput.value = '';
    showBubbleNotification("👋 ออกจากห้องแล้ว", `ลาก่อนห้อง ${leftRoom}! ข้อมูลยังคงอยู่สำหรับสมาชิกคนอื่นครับ`, "info");
}

// --- Owner leave dialog (owner ออกได้เฉพาะผ่านการลบห้อง) ---
function showOwnerLeaveDialog() {
    const existing = document.getElementById('owner-leave-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'owner-leave-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(100,60,60,0.35);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1.5rem;opacity:0;transition:opacity 0.2s;';
    overlay.innerHTML = `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xl);padding:2.5rem 2rem;max-width:360px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(160,80,80,0.18);">
            <div style="font-size:3rem;margin-bottom:1rem;line-height:1;">👑</div>
            <h2 style="font-size:1.15rem;font-weight:600;color:var(--text);margin-bottom:0.65rem;line-height:1.4;">คุณคือ Owner ของห้องนี้</h2>
            <p style="font-size:0.85rem;color:var(--text-2);line-height:1.75;margin-bottom:1.75rem;">Owner ไม่สามารถออกห้องได้โดยไม่ลบห้อง<br>หากออก ห้องและข้อมูลทั้งหมดจะถูกลบถาวร<br><span style="color:var(--red);font-weight:600;">ไม่สามารถย้อนกลับได้</span></p>
            <div style="display:flex;flex-direction:column;gap:10px;">
                <button id="owner-delete-room-btn" class="btn-create-room" style="background:linear-gradient(140deg,#e89090,#c05050);">🗑️ ลบห้องและออก</button>
                <button id="owner-cancel-leave-btn" class="btn-join-room" style="margin-top:0;">ยกเลิก ยังอยู่ในห้องต่อ</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    overlay.querySelector('#owner-delete-room-btn').addEventListener('click', () => {
        overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 200);
        deleteRoomAndLeave();
    });
    overlay.querySelector('#owner-cancel-leave-btn').addEventListener('click', () => {
        overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 200);
    });
}

async function deleteRoomAndLeave() {
    showBubbleNotification("🗑️ กำลังลบห้อง...", "กรุณารอสักครู่", "warning");
    isLeavingVoluntarily = true;
    if (dbTasksUnsubscribe) { dbTasksUnsubscribe(); dbTasksUnsubscribe = null; }
    if (dbMembersUnsubscribe) { dbMembersUnsubscribe(); dbMembersUnsubscribe = null; }
    closeCommentPanel();
    try { await deleteDoc(doc(db, "globalOnline", myUsername)); } catch {}
    const roomToDelete = currentRoomId;
    try {
        const deletionTasks = [];
        const aSnap = await getDocs(collection(db, "rooms", roomToDelete, "assignments"));
        aSnap.forEach(d => deletionTasks.push(deleteDoc(d.ref)));
        const mSnap = await getDocs(collection(db, "rooms", roomToDelete, "members"));
        mSnap.forEach(d => deletionTasks.push(deleteDoc(d.ref)));
        deletionTasks.push(deleteDoc(doc(db, "rooms", roomToDelete, "meta", "settings")));
        await Promise.all(deletionTasks);
    } catch (err) { console.error("ลบห้องไม่สำเร็จ:", err); }
    localStorage.removeItem('task777_last_room');
    currentRoomId = ""; roomOwner = ""; dueSoonNotified = false; assignments = []; localStatuses = {};
    isLeavingVoluntarily = false;
    mainAppScreen.classList.add('hidden');
    roomSelectionScreen.classList.remove('hidden');
    document.querySelectorAll('.code-box').forEach(b => b.value = '');
    roomCodeInput.value = '';
    showBubbleNotification("✅ ลบห้องเรียบร้อย", `ห้อง ${roomToDelete} และข้อมูลทั้งหมดถูกลบแล้ว`, "success");
}

// --- Kicked overlay (แสดงเมื่อ owner kick ออก) ---
function showKickedOverlay() {
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
    if (overlay) { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 300); }
    localStorage.removeItem('task777_last_room');
    currentRoomId = ""; roomOwner = ""; dueSoonNotified = false; assignments = []; localStatuses = {};
    mainAppScreen.classList.add('hidden');
    roomSelectionScreen.classList.remove('hidden');
    document.querySelectorAll('.code-box').forEach(b => b.value = '');
    roomCodeInput.value = '';
}

window.kickMember = function(targetName) {
    if (myUsername !== roomOwner) return;
    showBubbleConfirm(`Kick ${targetName}?`, `${targetName} จะถูกลบออกจากห้องทันที`, async () => {
        try {
            await deleteDoc(doc(db, "rooms", currentRoomId, "members", targetName));
            showBubbleNotification("👢 Kick สำเร็จ", `${targetName} ถูกนำออกจากห้องแล้ว`, "warning");
        } catch {
            showBubbleNotification("❌ Kick ไม่สำเร็จ", "โปรดลองใหม่อีกครั้ง", "danger");
        }
    });
}

function copyRoomCode() {
    navigator.clipboard.writeText(currentRoomId).then(() => {
        showBubbleNotification("📋 คัดลอกแล้ว!", `รหัสห้อง ${currentRoomId} อยู่ในคลิปบอร์ดแล้ว`, "info");
    });
}

function shareRoomLink() {
    const url = `${location.origin}${location.pathname}?room=${currentRoomId}`;
    navigator.clipboard.writeText(url).then(() => {
        showBubbleNotification("🔗 คัดลอกลิงก์แล้ว!", "ส่งให้เพื่อนได้เลย เปิดลิงก์แล้วเข้าห้องได้ทันที", "success");
    });
}

// ================================================================
// 👥 MEMBERS — render chip + owner badge
// ================================================================

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
        const ownerTag = isMemberOwner ? `<span class="owner-tag">owner</span>` : '';
        const kickBtn = (isOwner && !isMe && !isMemberOwner)
            ? `<button class="kick-btn" title="Kick ${escapeHTML(member.name)}" onclick="kickMember('${escapeHTML(member.name)}')">kick</button>`
            : '';
        chip.innerHTML = `
            <span class="member-chip ${isMemberOwner ? 'owner-chip' : ''}">
                ${ownerTag}${escapeHTML(label)}
            </span>
            ${kickBtn}
        `;
        activeMembersList.appendChild(chip);
    });
}

// ================================================================
// 📝 TASKS — modal, save, delete, pin, status
// ================================================================

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
            const linkInput = document.getElementById('task-link');
            if (linkInput) linkInput.value = task.link || '';
            if (task.dueDate) updateDueHint(parseDateLocal(task.dueDate));
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
    const linkRaw = document.getElementById('task-link')?.value.trim() || '';
    let link = '';
    if (linkRaw) link = linkRaw.startsWith('http') ? linkRaw : 'https://' + linkRaw;
    try {
        await setDoc(doc(db, "rooms", currentRoomId, "assignments", id),
            { id, subject, title, details, dueDate, link, createdBy: myUsername, updatedAt: new Date() },
            { merge: true }
        );
        await setDoc(doc(db, "rooms", currentRoomId, "meta", "settings"), { lastActivity: new Date() }, { merge: true });
        closeModal();
    } catch (error) {
        showBubbleNotification("❌ เซฟไม่สำเร็จ", "โปรดตรวจสอบ Rules ใน Firebase", "danger");
        console.error(error);
    }
}

window.deleteAssignmentFromServer = function(id) {
    showBubbleConfirm("ลบการบ้านใบนี้?", "เพื่อนทุกคนในห้องจะไม่เห็นงานนี้อีกต่อไป", async () => {
        await deleteDoc(doc(db, "rooms", currentRoomId, "assignments", id));
    });
}

window.triggerEditModal = function(id) { openModal('edit', id); }

window.togglePinTask = async function(taskId, currentPinned) {
    try {
        await setDoc(doc(db, "rooms", currentRoomId, "assignments", taskId), { pinned: !currentPinned }, { merge: true });
        showBubbleNotification(
            !currentPinned ? "📌 ปักหมุดแล้ว" : "📌 เอาหมุดออกแล้ว",
            !currentPinned ? "งานนี้จะแสดงด้านบนเสมอ" : "งานนี้กลับสู่ลำดับปกติ",
            "info"
        );
    } catch {
        showBubbleNotification("❌ ไม่สำเร็จ", "โปรดลองใหม่อีกครั้ง", "danger");
    }
}

window.changePersonalStatus = function(taskId, newStatus) {
    localStatuses[taskId] = newStatus;
    localStorage.setItem(`task777_statuses_${currentRoomId}`, JSON.stringify(localStatuses));
    renderUI();
}

// ================================================================
// 💬 COMMENTS — panel, listen, submit
// ================================================================

window.openCommentPanel = function(taskId) {
    const task = assignments.find(t => t.id === taskId);
    if (!task) return;
    currentCommentTaskId = taskId;
    const panel = document.getElementById('comment-panel');
    const titleEl = document.getElementById('comment-panel-title');
    if (titleEl) titleEl.textContent = `💬 ${task.subject}: ${task.title}`;
    panel?.classList.add('open');
    document.getElementById('comment-input')?.focus();

    if (commentUnsubscribe) { commentUnsubscribe(); commentUnsubscribe = null; }
    const q = query(
        collection(db, "rooms", currentRoomId, "assignments", taskId, "comments"),
        orderBy("createdAt", "asc")
    );
    commentUnsubscribe = onSnapshot(q, renderComments);
}

function closeCommentPanel() {
    document.getElementById('comment-panel')?.classList.remove('open');
    if (commentUnsubscribe) { commentUnsubscribe(); commentUnsubscribe = null; }
    currentCommentTaskId = null;
}

function renderComments(snapshot) {
    const list = document.getElementById('comment-list');
    if (!list) return;
    list.innerHTML = '';
    if (snapshot.empty) {
        list.innerHTML = '<p class="no-comments">ยังไม่มีความคิดเห็น เป็นคนแรกได้เลย!</p>';
        return;
    }
    snapshot.forEach(d => {
        const c = d.data();
        const isMe = c.author === myUsername;
        const timeStr = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
        const dateStr = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
        const div = document.createElement('div');
        div.className = `comment-item ${isMe ? 'mine' : 'theirs'}`;
        div.innerHTML = `
            <div class="comment-author">${escapeHTML(c.author)}${c.author === roomOwner ? ' 👑' : ''}</div>
            <div class="comment-bubble">${escapeHTML(c.text)}</div>
            <div class="comment-time">${dateStr} ${timeStr}</div>
        `;
        list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
}

async function submitComment() {
    const input = document.getElementById('comment-input');
    const text = input?.value.trim();
    if (!text || !currentCommentTaskId) return;
    input.value = '';
    try {
        await addDoc(
            collection(db, "rooms", currentRoomId, "assignments", currentCommentTaskId, "comments"),
            { text, author: myUsername, createdAt: serverTimestamp() }
        );
        await setDoc(doc(db, "rooms", currentRoomId, "meta", "settings"), { lastActivity: new Date() }, { merge: true });
    } catch {
        showBubbleNotification("❌ ส่ง comment ไม่ได้", "โปรดลองใหม่อีกครั้ง", "danger");
    }
}

// ================================================================
// 🎨 RENDER — วาด task cards + subject tags + stats
// ================================================================

function renderUI() {
    const searchQuery = searchInput.value.toLowerCase();
    assignmentsList.innerHTML = '';

    // --- Stats counter ---
    let todoCount = 0, finishedCount = 0, submittedCount = 0;
    assignments.forEach(t => {
        const s = localStatuses[t.id] || "todo";
        if (s === "todo") todoCount++;
        if (s === "finished") finishedCount++;
        if (s === "submitted") submittedCount++;
    });
    document.getElementById('stat-total').textContent = assignments.length;
    document.getElementById('stat-todo').textContent = todoCount;
    document.getElementById('stat-finished').textContent = finishedCount;
    document.getElementById('stat-submitted').textContent = submittedCount;

    // --- Subject tags ---
    const uniqueSubjects = new Set(assignments.map(t => t.subject));
    renderSubjectTags(Array.from(uniqueSubjects));

    // --- Filter + search ---
    const filteredTasks = assignments.filter(task => {
        const s = localStatuses[task.id] || "todo";
        return (task.subject.toLowerCase().includes(searchQuery) || task.title.toLowerCase().includes(searchQuery))
            && (activeFilter === "all" || s === activeFilter)
            && (activeSubjectFilter === "all" || task.subject === activeSubjectFilter);
    });

    // --- Sort (pinned ขึ้นก่อนเสมอ, แล้วค่อย sort ตาม due/newest) ---
    filteredTasks.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        if (activeSortOrder === "due") {
            const da = a.dueDate ? parseDateLocal(a.dueDate) : new Date("9999-12-31");
            const db_ = b.dueDate ? parseDateLocal(b.dueDate) : new Date("9999-12-31");
            return da - db_;
        }
        return Number(b.id) - Number(a.id);
    });

    // --- Render cards ---
    const isOwner = myUsername === roomOwner;
    filteredTasks.forEach(task => {
        const dueInfo = calculateDueInfo(task.dueDate);
        const currentStatus = localStatuses[task.id] || "todo";
        const isTaskCreatorOwner = task.createdBy === roomOwner;
        const canEdit = myUsername === task.createdBy || isOwner;
        const isPinned = task.pinned || false;

        const card = document.createElement('div');
        card.className = `task-card glow-${dueInfo.color}${isPinned ? ' pinned-card' : ''}`;

        const linkBtn = task.link
            ? `<a class="btn-link" href="${escapeHTML(task.link)}" target="_blank" rel="noopener">🔗 เปิดลิงก์</a>`
            : '';
        const pinBtn = isOwner
            ? `<button class="btn-pin ${isPinned ? 'active' : ''}" onclick="togglePinTask('${task.id}', ${isPinned})" title="${isPinned ? 'เอาหมุดออก' : 'ปักหมุด'}">${isPinned ? '📌 ปักอยู่' : '📌'}</button>`
            : (isPinned ? `<span class="pin-badge">📌 ปักหมุด</span>` : '');

        card.innerHTML = `
            <div class="card-top">
                <span class="sbj-badge">${escapeHTML(task.subject)}</span>
                <span class="due-lbl ${dueInfo.color}">${dueInfo.text}</span>
            </div>
            <div class="card-mid">
                <h3>${isPinned ? '📌 ' : ''}${escapeHTML(task.title)}</h3>
                <p>${escapeHTML(task.details || 'ไม่มีรายละเอียดระบุไว้')}</p>
                ${linkBtn}
                <span class="creator-stamp">
                    👤 ${escapeHTML(task.createdBy || 'เพื่อนร่วมห้อง')}
                    ${isTaskCreatorOwner ? '<span class="owner-tag-inline">owner</span>' : ''}
                </span>
            </div>
            <div class="card-bot">
                <div class="status-grid">
                    <button class="st-btn ${currentStatus === 'todo'      ? 'active' : ''}" onclick="changePersonalStatus('${task.id}', 'todo')">To Do</button>
                    <button class="st-btn ${currentStatus === 'finished'  ? 'active' : ''}" onclick="changePersonalStatus('${task.id}', 'finished')">Finished</button>
                    <button class="st-btn ${currentStatus === 'submitted' ? 'active' : ''}" onclick="changePersonalStatus('${task.id}', 'submitted')">Submitted</button>
                </div>
                <div class="action-row">
                    ${pinBtn}
                    <button class="btn-comment" onclick="openCommentPanel('${task.id}')">💬 คอมเมนต์</button>
                    ${canEdit ? `<button class="btn-edit" onclick="triggerEditModal('${task.id}')">แก้ไข</button>` : `<span class="no-edit-label">เพิ่มโดย ${escapeHTML(task.createdBy || '?')}</span>`}
                    ${canEdit ? `<button class="btn-del" onclick="deleteAssignmentFromServer('${task.id}')">ลบ</button>` : ''}
                </div>
            </div>
        `;
        assignmentsList.appendChild(card);
    });

    if (filteredTasks.length === 0) {
        assignmentsList.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:4rem 0;font-size:0.85rem;letter-spacing:0.3px;">ไม่มีภารกิจการบ้านค้างอยู่ในหมวดหมู่นี้ครับ</p>`;
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

// ================================================================
// 🛠️ UTILS — helper functions เล็กน้อยใช้ทั่วไป
// ================================================================

// เพิ่มใหม่: hash รหัสผ่านก่อนเก็บ/เทียบ
async function hashPassword(pwd) {
    const msgBuffer = new TextEncoder().encode(pwd);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseDateLocal(dateString) {
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function calculateDueInfo(dateString) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = parseDateLocal(dateString);
    const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0)  return { color: "red",    text: `⚠️ เกินกำหนด (${Math.abs(diffDays)} วัน)` };
    if (diffDays <= 7) return { color: "orange", text: `⏳ เหลืออีก ${diffDays} วัน` };
    return                    { color: "green",  text: `🗓️ อีก ${diffDays} วัน` };
}

function updateDueHint(d) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / (1000 * 60 * 60 * 24));
    const hint = document.getElementById('due-hint');
    if (!hint) return;
    if (diff < 0)        hint.innerHTML = `<span class="hint-red">⚠️ เกินกำหนดไปแล้ว ${Math.abs(diff)} วัน</span>`;
    else if (diff === 0) hint.innerHTML = `<span class="hint-orange">⏳ ส่งวันนี้!</span>`;
    else if (diff <= 7)  hint.innerHTML = `<span class="hint-orange">⏳ เหลืออีก ${diff} วัน</span>`;
    else                 hint.innerHTML = `<span class="hint-green">🗓️ เหลืออีก ${diff} วัน</span>`;
}

function checkDueSoonNotification() {
    if (dueSoonNotified) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const urgent = assignments.filter(task => {
        if ((localStatuses[task.id] || "todo") === "submitted") return false;
        const diff = Math.round((parseDateLocal(task.dueDate) - today) / (1000 * 60 * 60 * 24));
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

function syncRoomCode() {
    roomCodeInput.value = Array.from(document.querySelectorAll('.code-box')).map(b => b.value).join('');
}

function escapeHTML(str) {
    return String(str).replace(/[&<>'"]/g,
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}
