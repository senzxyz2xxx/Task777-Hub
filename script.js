import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

// ✅ คีย์โปรเจกต์จริงของคุณ (อ้างอิงจาก Firebase คอนโซลที่คุณส่งมา)
const firebaseConfig = {
    apiKey: "AIzaSyCu0ls1s27IMAQyuMiUo9iVq0K6gNluDXI",
    authDomain: "task777-4ff59.firebaseapp.com",
    projectId: "task777-4ff59",
    storageBucket: "task777-4ff59.firebasestorage.app",
    messagingSenderId: "715058556919",
    appId: "1:715058556919:web:37a01e94289ae9589908f2",
    measurementId: "G-70C4QSXPW6"
};

// ✅ เชื่อมต่อระบบ Firebase และดึงฐานข้อมูล Firestore (แก้บั๊กตัวแปร db หาย)
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ประกาศตัวแปรสถานะในแอป
let currentRoomId = "";
let myUsername = "";
let dbTasksUnsubscribe = null;
let dbMembersUnsubscribe = null;
let assignments = [];
let localStatuses = {};
let activeFilter = "all";
let activeSubjectFilter = "all";
let isInitialLoad = true;

const roomSelectionScreen = document.getElementById('room-selection-screen');
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

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('join-room-btn').addEventListener('click', joinRoom);
    document.getElementById('create-room-btn').addEventListener('click', createNewRoom);
    document.getElementById('leave-room-btn').addEventListener('click', leaveRoom);
    document.getElementById('copy-room-btn').addEventListener('click', copyRoomCode);
    document.getElementById('open-modal-btn').addEventListener('click', () => openModal('create'));
    document.getElementById('close-modal-btn').addEventListener('click', closeModal);
    taskForm.addEventListener('submit', saveAssignmentToServer);
    searchInput.addEventListener('input', renderUI);

    document.querySelectorAll('.filter-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            activeFilter = e.target.getAttribute('data-filter');
            renderUI();
        });
    });

    // ดึงประวัติข้อมูลผู้ใช้เดิมหากมีบันทึกค้างไว้
    const savedRoom = localStorage.getItem('task777_last_room');
    const savedName = localStorage.getItem('task777_my_username');
    if (savedName) usernameInput.value = savedName;
    if (savedRoom && savedName) {
        myUsername = savedName;
        enterRoom(savedRoom);
    }
});

// ฟังก์ชันเปิดบับเบิ้ลแจ้งเตือนบนมุมจอ
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

    // ทำลายตัวเองทิ้งเมื่อถึง 3.5 วินาที
    setTimeout(() => {
        bubble.classList.remove('show');
        setTimeout(() => bubble.remove(), 300);
    }, 3500);
}

// สร้างรหัสห้องแบบตัวเลขสั้น 4 หลักตามเงื่อนไขใหม่
function createNewRoom() {
    const name = usernameInput.value.trim();
    if (!name) { alert('กรุณากรอกชื่อเล่นของคุณก่อนสร้างห้องครับ'); return; }
    myUsername = name;
    localStorage.setItem('task777_my_username', name);

    const fourDigitCode = Math.floor(1000 + Math.random() * 9000).toString();
    enterRoom(fourDigitCode);
    setTimeout(() => showBubbleNotification("สร้างห้องสำเร็จ", `ห้องสี่หลักของคุณคือรหัส: ${fourDigitCode}`, "success"), 500);
}

// เข้าร่วมห้องเรียนเดิม
function joinRoom() {
    const name = usernameInput.value.trim();
    const code = roomCodeInput.value.trim();
    if (!name) { alert('กรุณาระบุชื่อเล่นของคุณก่อนครับ'); return; }
    if (code.length !== 4 || isNaN(code)) { alert('รหัสห้องต้องเป็นตัวเลข 4 หลักเท่านั้นครับ'); return; }
    
    myUsername = name;
    localStorage.setItem('task777_my_username', name);
    enterRoom(code);
}

// ฟังก์ชันเข้าห้องและเชื่อมความสัมพันธ์ออนไลน์
async function enterRoom(roomId) {
    currentRoomId = roomId;
    localStorage.setItem('task777_last_room', roomId);
    isInitialLoad = true;
    
    localStatuses = JSON.parse(localStorage.getItem(`task777_statuses_${currentRoomId}`)) || {};
    currentRoomText.textContent = currentRoomId;
    
    roomSelectionScreen.classList.add('hidden');
    mainAppScreen.classList.remove('hidden');
    
    // อัปโหลดข้อมูลชื่อเราขึ้นประวัติห้องเพื่อรายงานสมาชิกออนไลน์
    try {
        const memberDocRef = doc(db, "rooms", currentRoomId, "members", myUsername);
        await setDoc(memberDocRef, { name: myUsername, onlineAt: new Date() });
    } catch (err) {
        console.error("Firebase Error (สิทธิ์ Rules อาจยังไม่เปิด):", err);
    }

    // เคลียร์ระบบท่อเก่าถ้ามีค้าง
    if (dbTasksUnsubscribe) dbTasksUnsubscribe();
    if (dbMembersUnsubscribe) dbMembersUnsubscribe();
    
    // ท่อที่ 1: ติดตามการบ้านออนไลน์เรียลไทม์
    dbTasksUnsubscribe = onSnapshot(collection(db, "rooms", currentRoomId, "assignments"), (snapshot) => {
        const previousLength = assignments.length;
        const freshList = [];
        snapshot.forEach((doc) => { freshList.push({ id: doc.id, ...doc.data() }); });

        if (!isInitialLoad) {
            snapshot.docChanges().forEach((change) => {
                const data = change.doc.data();
                if (change.type === "added" && freshList.length > previousLength) {
                    showBubbleNotification("📝 การบ้านเข้าใหม่!", `วิชา ${data.subject}: โดยคุณ ${data.createdBy || 'เพื่อนในห้อง'}`, "success");
                }
                if (change.type === "modified") {
                    showBubbleNotification("✏️ ปรับปรุงงาน", `วิชา ${data.subject} มีการแก้ไขรายละเอียดโดยคุณ ${data.createdBy}`, "warning");
                }
                if (change.type === "removed") {
                    showBubbleNotification("🗑️ ลบการบ้านออก", `การบ้านถูกลบออกจากกลุ่มเรียลไทม์`, "danger");
                }
            });
        }
        
        assignments = freshList;
        isInitialLoad = false;
        renderUI();
    }, (error) => {
        showBubbleNotification("❌ ข้อผิดพลาดคลาวด์", "โปรดตรวจสอบการตั้งค่า Rules ในหน้าเว็บ Firebase", "danger");
    });

    // ท่อที่ 2: ติดตามและรายงานรายชื่อสมาชิกที่เปิดเว็บอยู่ในห้องเดียวกัน
    dbMembersUnsubscribe = onSnapshot(collection(db, "rooms", currentRoomId, "members"), (snapshot) => {
        activeMembersList.innerHTML = '';
        snapshot.forEach((doc) => {
            const member = doc.data();
            const chip = document.createElement('span');
            chip.className = 'member-chip';
            chip.textContent = member.name === myUsername ? `${member.name} (คุณ)` : member.name;
            activeMembersList.appendChild(chip);
        });
    });
}

// ออกจากห้อง
async function leaveRoom() {
    try {
        await deleteDoc(doc(db, "rooms", currentRoomId, "members", myUsername));
    } catch(e){}

    if (dbTasksUnsubscribe) dbTasksUnsubscribe();
    if (dbMembersUnsubscribe) dbMembersUnsubscribe();
    localStorage.removeItem('task777_last_room');
    currentRoomId = "";
    assignments = [];
    mainAppScreen.classList.add('hidden');
    roomSelectionScreen.classList.remove('hidden');
    roomCodeInput.value = "";
}

function copyRoomCode() {
    navigator.clipboard.writeText(currentRoomId).then(() => {
        showBubbleNotification("📋 สำเร็จ", `คัดลอกรหัสห้อง ${currentRoomId} ไปยังคลิปบอร์ดแล้ว`, "info");
    });
}

function calculateDueInfo(dateString) {
    const today = new Date(); today.setHours(0,0,0,0);
    const due = new Date(dateString); due.setHours(0,0,0,0);
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { color: "red", text: `⚠️ เกินกำหนด (${Math.abs(diffDays)} วัน)` };
    if (diffDays <= 7) return { color: "orange", text: `⏳ เหลืออีก ${diffDays} วัน` };
    return { color: "green", text: `🗓️ อีก ${diffDays} วัน` };
}

window.changePersonalStatus = function(taskId, newStatus) {
    localStatuses[taskId] = newStatus;
    localStorage.setItem(`task777_statuses_${currentRoomId}`, JSON.stringify(localStatuses));
    renderUI();
}

function openModal(mode, id = null) {
    taskForm.reset();
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
        }
    }
    taskModal.classList.add('active');
}

function closeModal() { taskModal.classList.remove('active'); }

// บันทึกข้อมูลขึ้นระบบคลาวด์กลุ่มกลาง
async function saveAssignmentToServer(e) {
    e.preventDefault();
    const id = document.getElementById('task-id').value || Date.now().toString();
    const subject = document.getElementById('task-subject').value.trim();
    const title = document.getElementById('task-title').value.trim();
    const details = document.getElementById('task-details').value.trim();
    const dueDate = document.getElementById('task-date').value;

    try {
        const taskDocRef = doc(db, "rooms", currentRoomId, "assignments", id);
        await setDoc(taskDocRef, {
            id: id,
            subject: subject,
            title: title,
            details: details,
            dueDate: dueDate,
            createdBy: myUsername, 
            updatedAt: new Date()
        }, { merge: true });

        closeModal();
    } catch (error) {
        alert("เซฟงานไม่สำเร็จ! โปรดตรวจสอบว่าคุณได้แก้ไขกฎ Rules ใน Firebase ให้เป็นสิทธิ์สาธารณะแล้วหรือยัง");
        console.error(error);
    }
}

window.deleteAssignmentFromServer = async function(id) {
    if (confirm('หากลบการบ้านใบนี้ เพื่อนทุกคนในห้องจะหายไปด้วย คุณต้องการดำเนินการต่อใช่ไหม?')) {
        await deleteDoc(doc(db, "rooms", currentRoomId, "assignments", id));
    }
}

window.triggerEditModal = function(id) { openModal('edit', id); }

function renderUI() {
    const searchQuery = searchInput.value.toLowerCase();
    assignmentsList.innerHTML = '';
    
    let total = assignments.length;
    let todoCount = 0, finishedCount = 0, submittedCount = 0;

    const uniqueSubjects = new Set();
    assignments.forEach(t => uniqueSubjects.add(t.subject));
    renderSubjectTags(Array.from(uniqueSubjects));

    assignments.forEach(task => {
        const currentStatus = localStatuses[task.id] || "todo";
        if (currentStatus === "todo") todoCount++;
        if (currentStatus === "finished") finishedCount++;
        if (currentStatus === "submitted") submittedCount++;
    });

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-todo').textContent = todoCount;
    document.getElementById('stat-finished').textContent = finishedCount;
    document.getElementById('stat-submitted').textContent = submittedCount;

    const filteredTasks = assignments.filter(task => {
        const currentStatus = localStatuses[task.id] || "todo";
        const matchesSearch = task.subject.toLowerCase().includes(searchQuery) || task.title.toLowerCase().includes(searchQuery);
        const matchesTab = (activeFilter === "all") || (currentStatus === activeFilter);
        const matchesSubject = (activeSubjectFilter === "all") || (task.subject === activeSubjectFilter);
        
        return matchesSearch && matchesTab && matchesSubject;
    });

    filteredTasks.forEach(task => {
        const dueInfo = calculateDueInfo(task.dueDate);
        const currentStatus = localStatuses[task.id] || "todo";
        
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
                <span class="creator-stamp">👤 ผู้เพิ่ม: ${escapeHTML(task.createdBy || 'เพื่อนร่วมห้อง')}</span>
            </div>
            <div class="card-bot">
                <div class="status-grid">
                    <button class="st-btn ${currentStatus === 'todo' ? 'active' : ''}" data-status="todo" onclick="changePersonalStatus('${task.id}', 'todo')">To Do</button>
                    <button class="st-btn ${currentStatus === 'finished' ? 'active' : ''}" data-status="finished" onclick="changePersonalStatus('${task.id}', 'finished')">Finished</button>
                    <button class="st-btn ${currentStatus === 'submitted' ? 'active' : ''}" data-status="submitted" onclick="changePersonalStatus('${task.id}', 'submitted')">Submitted</button>
                </div>
                <div class="action-row">
                    <button class="btn-edit" onclick="triggerEditModal('${task.id}')">แก้ไขงาน</button>
                    <button class="btn-del" onclick="deleteAssignmentFromServer('${task.id}')">ลบ</button>
                </div>
            </div>
        `;
        assignmentsList.appendChild(card);
    });

    if (filteredTasks.length === 0) {
        assignmentsList.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--text-muted); padding:3rem 0;">ไม่มีภารกิจการบ้านค้างอยู่ในหมวดหมู่นี้ครับ</p>`;
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
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}