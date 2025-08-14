/* ===============================
   شطرنج خرافي – منطق اللعبة الكامل
   - تمثيل اللوح + توليد النقلات القانونية
   - التبييت، الأخذ في المرور، الترقية
   - كش/كش مات/تعادل، تدوير اللوح، تراجع
================================== */

const boardEl = document.getElementById('board');
const turnLabel = document.getElementById('turnLabel');
const stateLabel = document.getElementById('stateLabel');
const moveListEl = document.getElementById('moveList');
const undoBtn = document.getElementById('undoBtn');
const flipBtn = document.getElementById('flipBtn');
const newGameBtn = document.getElementById('newGameBtn');
const startFenSel = document.getElementById('startFen');

const promoDialog = document.getElementById('promoDialog');
const promoForm = document.getElementById('promoForm');

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

let state = {
  board: emptyBoard(),
  whiteToMove: true,
  castling: { K:true, Q:true, k:true, q:true }, // حقوق التبييت
  epTarget: null, // خانة الأخذ في المرور مثل "e6"
  halfmoveClock: 0,
  fullmoveNumber: 1,
  history: [],
  selected: null, // {r,c}
  flipped: false, // تدوير اللوح
};

const UNICODE = {
  'P':'♙','N':'♘','B':'♗','R':'♖','Q':'♕','K':'♔',
  'p':'♟','n':'♞','b':'♝','r':'♜','q':'♛','k':'♚'
};

function emptyBoard(){ return Array.from({length:8}, ()=> Array(8).fill(null)); }

function algebra(r,c){ return "abcdefgh"[c] + (8-r); }
function fromAlg(s){
  const file = "abcdefgh".indexOf(s[0]);
  const rank = 8 - parseInt(s[1],10);
  return {r: rank, c: file};
}

function inBounds(r,c){ return r>=0 && r<8 && c>=0 && c<8; }

function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

/* ====== FEN ====== */
function loadFEN(fen){
  const [pieces, active, castling, ep, half, full] = fen.split(/\s+/);
  state.board = emptyBoard();
  let r = 0, c = 0;
  for (const ch of pieces){
    if (ch === '/'){ r++; c=0; continue; }
    if (/\d/.test(ch)){ c += parseInt(ch,10); continue; }
    state.board[r][c] = { t: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b', moved:false };
    c++;
  }
  state.whiteToMove = (active === 'w');
  state.castling = { K:false, Q:false, k:false, q:false };
  for (const k of castling.split('')) if ("KQkq".includes(k)) state.castling[k] = true;
  state.epTarget = (ep !== '-' ? ep : null);
  state.halfmoveClock = parseInt(half||'0',10);
  state.fullmoveNumber = parseInt(full||'1',10);
  state.history = [];
  state.selected = null;
  render();
  updateStatus();
}

function toFEN(){
  let rows=[];
  for (let r=0;r<8;r++){
    let row="", empty=0;
    for (let c=0;c<8;c++){
      const p = state.board[r][c];
      if (!p){ empty++; continue; }
      if (empty>0){ row+=empty; empty=0; }
      const ch = p.t;
      row += (p.color==='w'? ch.toUpperCase(): ch);
    }
    if (empty>0) row+=empty;
    rows.push(row);
  }
  const pieces = rows.join('/');
  const active = state.whiteToMove ? 'w':'b';
  const cast = Object.entries(state.castling).filter(([k,v])=>v).map(([k])=>k).join('')||'-';
  const ep = state.epTarget || '-';
  const half = state.halfmoveClock||0;
  const full = state.fullmoveNumber||1;
  return `${pieces} ${active} ${cast} ${ep} ${half} ${full}`;
}

/* ====== رسم اللوح ====== */
function render(){
  boardEl.innerHTML = '';
  const order = [...Array(8).keys()];
  const rows = state.flipped ? order : order;
  const cols = state.flipped ? order : order;
  for (let rr=0; rr<8; rr++){
    for (let cc=0; cc<8; cc++){
      const r = state.flipped ? 7-rr : rr;
      const c = state.flipped ? 7-cc : cc;

      const sq = document.createElement('div');
      sq.className = `square ${(r+c)%2===0? 'light':'dark'}`;
      sq.dataset.r = r; sq.dataset.c = c;
      sq.setAttribute('role','gridcell');
      sq.setAttribute('aria-label', algebra(r,c));

      const p = state.board[r][c];
      if (p){
        const span = document.createElement('span');
        span.className = `piece ${p.color==='w'?'white':'black'}`;
        span.textContent = UNICODE[p.color==='w' ? p.t.toUpperCase() : p.t];
        sq.appendChild(span);
      }
      sq.addEventListener('click', onSquareClick);
      boardEl.appendChild(sq);
    }
  }
  highlightCheck();
}

function highlightCheck(){
  // علّم الملك إذا كان في كش
  const kingPos = findKing(state.whiteToMove ? 'w':'b');
  if (!kingPos) return;
  if (isInCheck(state.whiteToMove ? 'w':'b')){
    const idx = index(kingPos.r, kingPos.c);
    const el = boardEl.children[idx];
    if (el) el.classList.add('king-check');
  }
}

function index(r,c){ return (state.flipped? (7-r)*8 + (7-c) : r*8 + c); }

/* ====== أحداث النقر ====== */
function onSquareClick(e){
  const r = parseInt(e.currentTarget.dataset.r,10);
  const c = parseInt(e.currentTarget.dataset.c,10);
  const selected = state.selected;
  const piece = state.board[r][c];

  if (selected && selected.r===r && selected.c===c){
    clearHints();
    state.selected = null;
    return;
  }

  if (selected){
    const moves = legalMovesFor(selected.r, selected.c);
    const dest = moves.find(m => m.r===r && m.c===c);
    if (dest){
      makeMove(selected.r, selected.c, dest);
      clearHints();
      state.selected = null;
      render();
      updateStatus();
      return;
    } else {
      // إعادة اختيار
      clearHints();
      state.selected = null;
    }
  }

  if (piece && ((piece.color==='w')===state.whiteToMove)){
    state.selected = {r,c};
    showHints(r,c);
  }
}

function clearHints(){
  [...boardEl.children].forEach(sq=>{
    sq.classList.remove('selected','capture');
    const dot = sq.querySelector('.hint');
    if (dot) dot.remove();
  });
}

function showHints(r,c){
  clearHints();
  const idx = index(r,c);
  const srcEl = boardEl.children[idx];
  srcEl.classList.add('selected');
  const moves = legalMovesFor(r,c);
  moves.forEach(m=>{
    const i = index(m.r, m.c);
    const el = boardEl.children[i];
    if (!el) return;
    const hint = document.createElement('div');
    hint.className = 'hint';
    if (m.capture) el.classList.add('capture');
    el.appendChild(hint);
  });
}

/* ====== منطق الشطرنج ====== */
function findKing(color){
  for (let r=0;r<8;r++) for (let c=0;c<8;c++){
    const p = state.board[r][c];
    if (p && p.t==='k' && p.color===color) return {r,c};
  }
  return null;
}

function isInCheck(color){
  const k = findKing(color);
  if (!k) return false;
  return isSquareAttacked(k.r, k.c, color);
}

function isSquareAttacked(r,c, colorDefender){
  const attacker = colorDefender==='w' ? 'b':'w';

  // فحص اتجاهات متعددة للوزير والرخ والفيل
  const dirsRook = [[1,0],[-1,0],[0,1],[0,-1]];
  const dirsBishop = [[1,1],[1,-1],[-1,1],[-1,-1]];
  // رُخ أو وزير
  for (const [dr,dc] of dirsRook){
    let rr=r+dr, cc=c+dc;
    while(inBounds(rr,cc)){
      const p = state.board[rr][cc];
      if (p){
        if (p.color===attacker && (p.t==='r' || p.t==='q')) return true;
        break;
      }
      rr+=dr; cc+=dc;
    }
  }
  // فيل أو وزير
  for (const [dr,dc] of dirsBishop){
    let rr=r+dr, cc=c+dc;
    while(inBounds(rr,cc)){
      const p = state.board[rr][cc];
      if (p){
        if (p.color===attacker && (p.t==='b' || p.t==='q')) return true;
        break;
      }
      rr+=dr; cc+=dc;
    }
  }
  // حصان
  const knights = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
  for (const [dr,dc] of knights){
    const rr=r+dr, cc=c+dc;
    if (inBounds(rr,cc)){
      const p = state.board[rr][cc];
      if (p && p.color===attacker && p.t==='n') return true;
    }
  }
  // بيادق
  const dir = (attacker==='w' ? -1 : 1);
  for (const dc of [-1,1]){
    const rr=r+dir, cc=c+dc;
    if (inBounds(rr,cc)){
      const p = state.board[rr][cc];
      if (p && p.color===attacker && p.t==='p') return true;
    }
  }
  // ملك
  for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++){
    if (!dr && !dc) continue;
    const rr=r+dr, cc=c+dc;
    if (!inBounds(rr,cc)) continue;
    const p = state.board[rr][cc];
    if (p && p.color===attacker && p.t==='k') return true;
  }
  return false;
}

function legalMovesFor(r,c){
  const p = state.board[r][c];
  if (!p) return [];
  const moves = [];
  const color = p.color;
  const forward = (color==='w') ? -1 : 1;

  const push = (rr,cc, opts={})=>{
    if (!inBounds(rr,cc)) return;
    // لا نسمح بالاصطدام بقطعتنا
    const dst = state.board[rr][cc];
    if (dst && dst.color===color) return;
    const mv = { r:rr, c:cc, capture: !!dst, ...opts };
    // اختبار شرعية الحركة (عدم ترك الملك مكشوفًا)
    if (isMoveLegal(r,c,mv)) moves.push(mv);
  };

  switch(p.t){
    case 'p':{
      // خطوة للأمام
      const rr = r + forward;
      if (inBounds(rr,c) && !state.board[rr][c]){
        // ترقية؟
        const promoRank = (color==='w'?0:7);
        if (rr===promoRank){
          push(rr,c,{promotion:true});
        } else {
          push(rr,c);
          // خطوتين من الصف الابتدائي
          const startRank = (color==='w'?6:1);
          const rr2 = r + 2*forward;
          if (r===startRank && !state.board[rr2]?.[c] && !state.board[rr][c]){
            push(rr2,c,{double:true});
          }
        }
      }
      // أكل جانبي
      for (const dc of [-1,1]){
        const cc=c+dc;
        const rr2=r+forward;
        if (!inBounds(rr2,cc)) continue;
        const dst = state.board[rr2][cc];
        if (dst && dst.color!==color){
          const promoRank = (color==='w'?0:7);
          if (rr2===promoRank) push(rr2,cc,{promotion:true, capture:true});
          else push(rr2,cc,{capture:true});
        }
      }
      // أخذ في المرور
      if (state.epTarget){
        const ep = fromAlg(state.epTarget);
        if (ep.r === r+forward && Math.abs(ep.c - c)===1){
          push(ep.r, ep.c, {enPassant:true, capture:true});
        }
      }
      break;
    }
    case 'n':{
      const ks = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
      for (const [dr,dc] of ks) push(r+dr, c+dc);
      break;
    }
    case 'b': slideDirs([[1,1],[1,-1],[-1,1],[-1,-1]]); break;
    case 'r': slideDirs([[1,0],[-1,0],[0,1],[0,-1]]); break;
    case 'q': slideDirs([[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]); break;
    case 'k':{
      for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++){
        if (!dr && !dc) continue;
        push(r+dr, c+dc);
      }
      // التبييت
      if (!isInCheck(color)){
        // قصير
        if ((color==='w' && state.castling.K) || (color==='b' && state.castling.k)){
          if (!state.board[r][5] && !state.board[r][6] &&
              !isSquareAttacked(r,5,color) && !isSquareAttacked(r,6,color)){
            push(r,6,{castle:'king'});
          }
        }
        // طويل
        if ((color==='w' && state.castling.Q) || (color==='b' && state.castling.q)){
          if (!state.board[r][1] && !state.board[r][2] && !state.board[r][3] &&
              !isSquareAttacked(r,2,color) && !isSquareAttacked(r,3,color)){
            push(r,2,{castle:'queen'});
          }
        }
      }
      break;
    }
  }

  function slideDirs(dirs){
    for (const [dr,dc] of dirs){
      let rr=r+dr, cc=c+dc;
      while(inBounds(rr,cc)){
        const dst = state.board[rr][cc];
        if (!dst){
          push(rr,cc);
        } else {
          if (dst.color!==color) push(rr,cc,{capture:true});
          break;
        }
        rr+=dr; cc+=dc;
      }
    }
  }

  return moves;
}

function isMoveLegal(sr,sc, mv){
  // جرّب الحركة على نسخة ثم اختبر الكش
  const saved = snapshot();
  doMove(sr,sc,mv, {silent:true});
  const check = isInCheck(saved.whiteToMove ? 'w':'b'); // قبل التبديل
  restore(saved);
  return !check;
}

function snapshot(){
  return {
    board: clone(state.board),
    whiteToMove: state.whiteToMove,
    castling: clone(state.castling),
    epTarget: state.epTarget,
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber
  };
}
function restore(s){
  state.board = s.board;
  state.whiteToMove = s.whiteToMove;
  state.castling = s.castling;
  state.epTarget = s.epTarget;
  state.halfmoveClock = s.halfmoveClock;
  state.fullmoveNumber = s.fullmoveNumber;
}

function makeMove(sr,sc, mv){
  const before = snapshot();
  doMove(sr,sc,mv);
  state.history.push({ before, move: {from:{r:sr,c:sc}, to:{r:mv.r,c:mv.c}, mv} });
  logMove(sr,sc,mv);
}

function doMove(sr,sc, mv, opts={}){
  const piece = state.board[sr][sc];
  const tgt = state.board[mv.r][mv.c];

  // تحديث ساعة النقلات القصيرة
  if (piece.t==='p' || tgt) state.halfmoveClock = 0; else state.halfmoveClock++;

  // تفريغ خانة المصدر
  state.board[sr][sc] = null;

  // أخذ في المرور
  if (mv.enPassant){
    const dir = (piece.color==='w' ? 1 : -1);
    state.board[mv.r + dir][mv.c] = null;
  }

  // تحريك الملك والتبييت
  if (piece.t==='k'){
    // فقدان حقوق التبييت
    if (piece.color==='w'){ state.castling.K=false; state.castling.Q=false; }
    else { state.castling.k=false; state.castling.q=false; }

    if (mv.castle==='king'){
      // نقل الرخ
      state.board[mv.r][5] = state.board[mv.r][7];
      state.board[mv.r][7] = null;
      if (state.board[mv.r][5]) state.board[mv.r][5].moved = true;
    } else if (mv.castle==='queen'){
      state.board[mv.r][3] = state.board[mv.r][0];
      state.board[mv.r][0] = null;
      if (state.board[mv.r][3]) state.board[mv.r][3].moved = true;
    }
  }

  // إذا تحركت رُخ، حدث الحقوق
  if (piece.t==='r'){
    if (piece.color==='w' && sr===7 && sc===7) state.castling.K=false;
    if (piece.color==='w' && sr===7 && sc===0) state.castling.Q=false;
    if (piece.color==='b' && sr===0 && sc===7) state.castling.k=false;
    if (piece.color==='b' && sr===0 && sc===0) state.castling.q=false;
  }

  // إذا أُكِل رُخ في ركنه، حدّث الحقوق
  if (tgt && tgt.t==='r'){
    if (tgt.color==='w' && mv.r===7 && mv.c===7) state.castling.K=false;
    if (tgt.color==='w' && mv.r===7 && mv.c===0) state.castling.Q=false;
    if (tgt.color==='b' && mv.r===0 && mv.c===7) state.castling.k=false;
    if (tgt.color==='b' && mv.r===0 && mv.c===0) state.castling.q=false;
  }

  // ضع القطعة في الهدف
  state.board[mv.r][mv.c] = piece;
  piece.moved = true;

  // الترقية
  if (mv.promotion){
    if (opts.silent){
      piece.t = 'q'; // في التجربة الصامتة اختر وزير افتراضيًا
    } else {
      // اطلب من اللاعب اختيار الترقية
      const choice = promptPromotion(piece.color);
      piece.t = choice; // q r b n
    }
  }

  // هدف الأخذ في المرور بعد نقلة بيدق مزدوجة
  if (mv.double){
    const dir = (piece.color==='w' ? -1 : 1);
    state.epTarget = algebra(sr + dir, sc);
  } else {
    state.epTarget = null;
  }

  // تبديل الدور
  state.whiteToMove = !state.whiteToMove;
  if (!opts.silent){
    if (!state.whiteToMove) state.fullmoveNumber++;
  }
}

function promptPromotion(color){
  // استخدم <dialog> الجميل
  return new Promise(resolve=>{
    promoDialog.showModal();
    const handler = (e)=>{
      e.preventDefault();
      const val = e.submitter?.value || 'q';
      promoDialog.close();
      promoForm.removeEventListener('submit', handler);
      resolve(val);
    };
    promoForm.addEventListener('submit', handler, {once:true});
  });
}

/* تسجيل الحركة في القائمة (SAN مبسّطة) */
function logMove(sr,sc,mv){
  const moving = state.history.at(-1).before.board[sr][sc];
  const pieceLetter = (moving.t==='p') ? '' : moving.t.toUpperCase();
  const capture = mv.capture ? 'x' : '';
  const dst = algebra(mv.r, mv.c);
  let note = '';

  if (mv.castle==='king') note = 'O-O';
  else if (mv.castle==='queen') note = 'O-O-O';
  else note = `${pieceLetter}${capture}${dst}`;

  // تحقق من حالة كش/مات بعد الحركة
  const after = snapshot();
  const oppColor = after.whiteToMove ? 'w' : 'b';
  const inCheck = isInCheck(oppColor);
  const oppMoves = allLegalMoves(oppColor);
  if (inCheck && oppMoves.length===0) note += '#';
  else if (inCheck) note += '+';

  const li = document.createElement('li');
  li.textContent = note;
  moveListEl.appendChild(li);
  moveListEl.scrollTop = moveListEl.scrollHeight;
}

function allLegalMoves(color){
  const moves=[];
  for (let r=0;r<8;r++) for (let c=0;c<8;c++){
    const p = state.board[r][c];
    if (p && p.color===color){
      const ms = legalMovesFor(r,c);
      moves.push(...ms.map(m=>({from:{r,c}, to:{r:m.r,c:m.c}, m})));
    }
  }
  return moves;
}

function updateStatus(){
  turnLabel.textContent = state.whiteToMove ? 'الأبيض' : 'الأسود';
  const me = state.whiteToMove ? 'w':'b';
  const moves = allLegalMoves(me);
  const inCheckNow = isInCheck(me);

  let text = '—';
  if (moves.length===0 && inCheckNow) text = 'كش مات! 🎯';
  else if (moves.length===0) text = 'تعادل (ستيلميت) 🤝';
  else if (inCheckNow) text = 'كش! ⚠️';
  else text = 'جاري اللعب...';

  stateLabel.textContent = text;
}

/* ====== أزرار التحكم ====== */
undoBtn.addEventListener('click', ()=>{
  const last = state.history.pop();
  if (!last) return;
  restore(last.before);
  // احذف آخر عنصر من اللوج
  if (moveListEl.lastChild) moveListEl.removeChild(moveListEl.lastChild);
  render(); updateStatus();
});

flipBtn.addEventListener('click', ()=>{
  state.flipped = !state.flipped;
  render();
});

newGameBtn.addEventListener('click', ()=>{
  const fen = startFenSel.value==='start' ? START_FEN : startFenSel.value;
  loadFEN(fen);
  moveListEl.innerHTML = '';
  stateLabel.textContent = '—';
});

startFenSel.addEventListener('change', ()=>{
  const fen = startFenSel.value==='start' ? START_FEN : startFenSel.value;
  loadFEN(fen);
  moveListEl.innerHTML = '';
});

/* ====== تشغيل أولي ====== */
loadFEN(START_FEN);

/* ====== ملاحظات تقنية ======
- استخدام Unicode للقطع يعطي توافقًا عاليًا بدون صور/أيقونات.
- يمكن لاحقًا تبديلها لمجموعة SVG إذا رغبت.
- المنطق يغطي: شرعية النقلات، الكش، الكش مات، التبييت، الأخذ في المرور، الترقية، التعادل بالتوقف (ستيلميت).
================================ */

/* ====== تهيئة خاصة للترقية (Promise) ====== */
(function fixPromotion(){
  // نلف دالة makeMove لتنتظر اختيار الترقية عند الحاجة
  const _makeMove = makeMove;
  makeMove = async function(sr,sc,mv){
    // إذا احتاجت الحركة ترقية، اجبر doMove على انتظار اختيار المستخدم
    if (mv.promotion){
      // نفّذ نسخة خاصة من doMove تطلب الترقية قبل حفظ التاريخ
      const before = snapshot();

      // انسخ الحركة ولكن بدون silent ليفتح الحوار
      // نحتاج تعديل doMove ليقبل انتظار Promise من promptPromotion
      await doMoveWithPromotion(sr,sc,mv);

      state.history.push({ before, move: {from:{r:sr,c:sc}, to:{r:mv.r,c:mv.c}, mv} });
      logMove(sr,sc,mv);
      render(); updateStatus();
    } else {
      _makeMove(sr,sc,mv);
    }
  };
})();

async function doMoveWithPromotion(sr,sc,mv){
  const piece = state.board[sr][sc];
  const tgt = state.board[mv.r][mv.c];
  if (piece.t!=='p' || !mv.promotion){
    doMove(sr,sc,mv);
    return;
  }
  // نسخة من doMove لكن تنتظر اختيار الترقية
  state.board[sr][sc] = null;

  // en passant
  if (mv.enPassant){
    const dir = (piece.color==='w' ? 1 : -1);
    state.board[mv.r + dir][mv.c] = null;
  }

  // castling (غير مرتبط بالبيادق لكن نتركه ثابتًا)
  // لا شيء هنا للبيادق

  // ضع القطعة مؤقتًا
  state.board[mv.r][mv.c] = piece;
  piece.moved = true;

  // اطلب نوع الترقية
  const choice = await promptPromotion(piece.color); // q r b n
  piece.t = choice;

  // EP
  if (mv.double){
    const dir = (piece.color==='w' ? -1 : 1);
    state.epTarget = algebra(sr + dir, sc);
  } else {
    state.epTarget = null;
  }

  // فقدان نصف النقلات
  state.halfmoveClock = 0;

  // تبديل الدور
  state.whiteToMove = !state.whiteToMove;
  if (!state.whiteToMove) state.fullmoveNumber++;
}
// ===== الوضع الافتراضي =====
if(!localStorage.getItem('theme')){
    document.documentElement.setAttribute('data-theme', 'dark');
} else {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('theme'));
}

// زر التبديل
const themeToggleBtn = document.getElementById('themeToggleBtn');
themeToggleBtn.addEventListener('click', () => {
    let currentTheme = document.documentElement.getAttribute('data-theme');
    let newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    themeToggleBtn.textContent = newTheme === 'dark' ? '🌙 تبديل الوضع' : '☀️ تبديل الوضع';
});

