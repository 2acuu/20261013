// ===== 題庫來源設定 =====
// 1) 優先讀取 Google 試算表（發布到網路 → CSV 連結），貼在下方引號內
// 2) 讀取失敗（網路問題、連結錯誤等）時，自動改用備用題庫 questions.csv
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSEYV6YZd_CqfyO1f4adD3WHA7XoWbwazliKbLR3d20kjGMbqdM3nwvQv-0dxlkMFYTyIEjjPoaNoLq/pubhtml?gid=1019277664&single=true';
const FALLBACK_CSV = 'questions.csv';
const QUESTION_COUNT = 5;      // 每次測驗抽出的題數
const FETCH_TIMEOUT_MS = 8000; // 讀取 Google 試算表的等待上限

let questions = [];       // 每次隨機抽出的測驗陣列
let currentQuestion = 0;  // 目前題目的索引
let score = 0;            // 累計答對題數
let hasAnswered = false;  // 是否已經作答當前題目
let quizFinished = false; // 測驗是否已結束

let loading = true;       // 是否正在載入題庫
let loadError = '';       // 載入失敗訊息
let questionSource = '';  // 目前題庫來源（顯示於畫面底部）

// 按鈕陣列與下一題按鈕
let optionButtons = [];
let nextButton;

function setup() {
  // 建立全螢幕畫布，自動適配手機、平板、電腦
  createCanvas(windowWidth, windowHeight);

  // 設定畫布預設文字字型為 Google Fonts 的 Noto Serif HK
  textFont('Noto Serif HK');

  // 建立「下一題 / 看總成績」按鈕
  nextButton = createButton('下一題');
  styleButton(nextButton, '#2b2d42', '#ffffff');
  nextButton.hide();
  nextButton.mousePressed(nextQuestionHandler);

  // 建立四個選項按鈕（題庫載入完成前先隱藏）
  for (let i = 0; i < 4; i++) {
    let btn = createButton('');
    styleOptionButton(btn);
    btn.hide();
    let idx = i;
    btn.mousePressed(() => checkAnswer(idx));
    optionButtons.push(btn);
  }

  // 非同步載入題庫：先 Google 試算表，失敗則用 questions.csv
  loadQuestionBank()
    .then(({ list, source }) => {
      questionSource = source;
      questions = shuffle(list).slice(0, min(QUESTION_COUNT, list.length));
      loading = false;
      updateQuizUI();
    })
    .catch((err) => {
      console.error(err);
      loadError = '題庫載入失敗，請檢查網路或 questions.csv';
      loading = false;
    });
}

// ===== 題庫載入 =====

async function loadQuestionBank() {
  // 1) 嘗試 Google 試算表
  if (SHEET_CSV_URL && SHEET_CSV_URL.startsWith('http')) {
    try {
      // 加上時間參數避免瀏覽器快取，修改試算表後重新整理就能看到新題目
      const sep = SHEET_CSV_URL.includes('?') ? '&' : '?';
      const text = await fetchText(`${SHEET_CSV_URL}${sep}t=${Date.now()}`);
      const list = csvToQuestions(text);
      if (list.length > 0) {
        console.log(`已從 Google 試算表載入 ${list.length} 題`);
        return { list, source: 'Google 試算表' };
      }
      console.warn('Google 試算表沒有可用的題目，改用備用題庫');
    } catch (e) {
      console.warn('讀取 Google 試算表失敗，改用備用題庫：', e);
    }
  }

  // 2) 備用題庫 questions.csv
  const text = await fetchText(FALLBACK_CSV);
  const list = csvToQuestions(text);
  if (list.length === 0) throw new Error('questions.csv 沒有可用的題目');
  console.log(`已從 ${FALLBACK_CSV} 載入 ${list.length} 題`);
  return { list, source: '備用題庫 (questions.csv)' };
}

// 帶逾時的 fetch
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 解析 CSV 文字（支援雙引號包住的欄位、欄位內逗號與換行、BOM）
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// 將 CSV 轉為題目陣列；欄位：prompt, opt1, opt2, opt3, opt4, answer（answer 為 0～3）
function csvToQuestions(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  ['prompt', 'opt1', 'opt2', 'opt3', 'opt4', 'answer'].forEach((name) => {
    col[name] = header.indexOf(name);
  });
  // 欄位名稱不符（例如抓到登入頁或錯誤頁）就視為失敗
  if (Object.values(col).some((i) => i < 0)) {
    throw new Error('CSV 欄位名稱不正確，需要 prompt, opt1~opt4, answer');
  }

  const list = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (name) => (row[col[name]] || '').trim();

    const prompt = get('prompt');
    const options = [get('opt1'), get('opt2'), get('opt3'), get('opt4')];
    const answer = parseInt(get('answer'), 10);

    // 略過空白列或格式不完整的題目
    if (!prompt || options.some((o) => !o)) continue;
    if (isNaN(answer) || answer < 0 || answer > 3) {
      console.warn(`第 ${r + 1} 列的 answer 不是 0～3，已略過`);
      continue;
    }
    list.push({ prompt, options, answer });
  }
  return list;
}

// ===== 繪圖 =====

function draw() {
  // 設定背景顏色為 #e1e5f2
  background(225, 229, 242);

  // 根據螢幕尺寸動態調整字型大小（RWD響應式設計）
  let isMobile = width < 600;
  let titleSize = isMobile ? 20 : 26;
  let promptSize = isMobile ? 18 : 22;

  // 載入中或載入失敗的畫面
  if (loading || loadError) {
    push();
    noStroke();
    fill(43, 45, 66);
    textAlign(CENTER, CENTER);
    textSize(isMobile ? 18 : 22);
    text(loading ? '題庫載入中…' : loadError, width / 2, height / 2);
    pop();
    return;
  }

  if (!quizFinished) {
    // 繪製頂端測驗標題與進度
    push();
    textSize(titleSize);
    fill(43, 45, 66);
    noStroke();
    textAlign(CENTER, TOP);
    text(
      `高中中文能力測驗 (第 ${currentQuestion + 1} 題 / 共 ${questions.length} 題)`,
      width / 2,
      isMobile ? 20 : 40
    );
    pop();

    // 題目卡片尺寸與位置
    let boxWidth = min(width - 40, 700);
    let boxHeight = isMobile ? 130 : 110;
    let boxY = isMobile ? 110 : 130;

    // 繪製題目卡片背景（以中心為基準）
    push();
    fill(255, 255, 255, 200);
    noStroke();
    rectMode(CENTER);
    rect(width / 2, boxY, boxWidth, boxHeight, 12);
    pop();

    // 顯示題目文字：文字框同樣以中心為基準，正好落在卡片正中央
    push();
    rectMode(CENTER);
    textAlign(CENTER, CENTER);
    fill(43, 45, 66);
    noStroke();
    textSize(promptSize);
    text(questions[currentQuestion].prompt, width / 2, boxY, boxWidth - 30, boxHeight - 20);
    pop();

  } else {
    // 測驗結束後的結算畫面
    let finishTitleSize = isMobile ? 26 : 36;
    let finishTextSize = isMobile ? 18 : 24;
    let pointsPerQuestion = 100 / questions.length; // 依實際題數換算成百分制

    push();
    noStroke();
    textAlign(CENTER, CENTER);

    textSize(finishTitleSize);
    fill(43, 45, 66);
    text("📜 測驗圓滿結束！ 📜", width / 2, height / 2 - 100);

    textSize(finishTextSize);
    fill(75, 83, 105);
    text(`您的總得分為：${round(score * pointsPerQuestion)} 分`, width / 2, height / 2 - 30);
    text(`總答對題數：${score} / ${questions.length} 題`, width / 2, height / 2 + 20);
    pop();
  }

  // 畫面底部顯示題庫來源（方便確認目前讀到哪份題庫）
  push();
  noStroke();
  fill(141, 153, 174);
  textAlign(CENTER, BOTTOM);
  textSize(12);
  text(`題庫來源：${questionSource}`, width / 2, height - 10);
  pop();
}

// 更新選項按鈕的文字與動態排版位置（支援不同螢幕寬度）
function updateQuizUI() {
  if (quizFinished || questions.length === 0) return;

  let q = questions[currentQuestion];
  let isMobile = width < 600;

  // 計算選項按鈕的寬高與起始 Y 座標
  let btnWidth = min(width - 40, 700);
  let btnHeight = isMobile ? 55 : 50;
  let startY = isMobile ? 200 : 210;
  let spacing = isMobile ? 65 : 62;

  for (let i = 0; i < 4; i++) {
    let btn = optionButtons[i];
    btn.html(`(${i + 1}) ${q.options[i]}`);
    btn.show();

    // 恢復選項按鈕的預設樣式
    styleOptionButton(btn);

    // 定位按鈕位置（置中排列）
    btn.size(btnWidth, btnHeight);
    btn.position(width / 2 - btnWidth / 2, startY + i * spacing);
  }

  // 隱藏下一題按鈕，重設作答狀態
  nextButton.hide();
  hasAnswered = false;
}

// 檢查使用者點選的答案
function checkAnswer(selectedIndex) {
  if (hasAnswered) return; // 防止重複點擊
  hasAnswered = true;

  let q = questions[currentQuestion];
  let isMobile = width < 600;

  if (selectedIndex === q.answer) {
    score++;
    // 答對：選項轉為綠色，文字變白
    optionButtons[selectedIndex].style('background-color', '#2b9348');
    optionButtons[selectedIndex].style('color', '#ffffff');
    optionButtons[selectedIndex].style('border', '2px solid #1b4332');
    playCorrectSound();
  } else {
    // 答錯：選錯的變紅，正確答案顯示綠色
    optionButtons[selectedIndex].style('background-color', '#d90429');
    optionButtons[selectedIndex].style('color', '#ffffff');
    optionButtons[selectedIndex].style('border', '2px solid #8d0801');

    optionButtons[q.answer].style('background-color', '#2b9348');
    optionButtons[q.answer].style('color', '#ffffff');
    optionButtons[q.answer].style('border', '2px solid #1b4332');
    playWrongSound();
  }

  // 設置「下一題」或「看總成績」按鈕的文字與位置
  if (currentQuestion < questions.length - 1) {
    nextButton.html('下一題 ➔');
  } else {
    nextButton.html('查看總成績 🏆');
  }

  let btnWidth = min(width - 40, 300);
  let startY = isMobile ? 200 : 210;
  let spacing = isMobile ? 65 : 62;

  nextButton.show();
  nextButton.size(btnWidth, 48);
  nextButton.position(width / 2 - btnWidth / 2, startY + 4 * spacing + 10);
}

// 點擊「下一題」按鈕後的處理邏輯
function nextQuestionHandler() {
  currentQuestion++;
  if (currentQuestion < questions.length) {
    updateQuizUI();
  } else {
    quizFinished = true;
    // 結算時隱藏所有作答按鈕
    for (let btn of optionButtons) {
      btn.hide();
    }
    nextButton.hide();
  }
}

// 視窗大小改變時自動調整畫布與元件
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  if (!loading && !loadError && !quizFinished) {
    updateQuizUI();
  }
}

// 選項按鈕通用樣式設定（套用 Noto Serif HK 字型）
function styleOptionButton(btn) {
  btn.style('font-family', '"Noto Serif HK", serif');
  btn.style('font-weight', '500');
  btn.style('font-size', width < 600 ? '15px' : '17px');
  btn.style('background-color', '#ffffff');
  btn.style('color', '#2b2d42');
  btn.style('border', '2px solid #8d99ae');
  btn.style('border-radius', '8px');
  btn.style('cursor', 'pointer');
  btn.style('text-align', 'left');
  btn.style('padding-left', '15px');
  btn.style('box-shadow', '0 4px 6px rgba(0, 0, 0, 0.05)');
}

// 下一題按鈕通用樣式設定（套用 Noto Serif HK 字型）
function styleButton(btn, bgColor, textColor) {
  btn.style('font-family', '"Noto Serif HK", serif');
  btn.style('font-size', '18px');
  btn.style('font-weight', 'bold');
  btn.style('background-color', bgColor);
  btn.style('color', textColor);
  btn.style('border', 'none');
  btn.style('border-radius', '8px');
  btn.style('cursor', 'pointer');
  btn.style('box-shadow', '0 4px 8px rgba(0, 0, 0, 0.15)');
}

// 答對音效（需載入 p5.sound 函式庫）
function playCorrectSound() {
  let osc = new p5.Oscillator('sine');
  osc.freq(587.33); // D5 音符
  osc.amp(0.2);
  osc.start();
  osc.stop(0.18); // 0.18 秒後自動停止
}

// 答錯音效
function playWrongSound() {
  let osc = new p5.Oscillator('sawtooth');
  osc.freq(160); // 低音頻率
  osc.amp(0.25);
  osc.start();
  osc.stop(0.25); // 0.25 秒後自動停止
}