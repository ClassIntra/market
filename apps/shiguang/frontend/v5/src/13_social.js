  // ---------------- §15.5 社交层（点人 / 表情 / 潮汐卡） ----------------
  // 校园里最重要的一步是「看见同班同学」。所以：点一下同学就能邀请组队、扶起、发表情。

  S.emotes = [];
  S.party = null;
  S.quests = {};
  S.tideInfo = null;
  S.pendingInvite = '';

  var EMOTE_SET = [
    { id: 'wave', ch: '👋', name: '打招呼' },
    { id: 'heart', ch: '❤', name: '比心' },
    { id: 'note', ch: '♪', name: '来首歌' },
    { id: 'zzz', ch: 'Zz', name: '困了' },
    { id: 'spark', ch: '✦', name: '好耶' },
    { id: 'ask', ch: '?', name: '救命' }
  ];

  function showEmote(p) {
    var found = null;
    for (var i = 0; i < EMOTE_SET.length; i++) if (EMOTE_SET[i].id === p.e) found = EMOTE_SET[i];
    if (!found) return;
    S.emotes.push({ x: p.x, y: p.y, ch: found.ch, id: p.e, until: S.time + 2.4 });
    if (S.emotes.length > 12) S.emotes.shift();
  }

  function drawEmotes() {
    if (!S.emotes.length) return;
    var ctx = S.ctx;
    for (var i = S.emotes.length - 1; i >= 0; i--) {
      var e = S.emotes[i];
      if (S.time > e.until) { S.emotes.splice(i, 1); continue; }
      var k = (e.until - S.time) / 2.4;
      var x = w2sX(e.x * TILE), y = w2sY(e.y * TILE) - 34 - (1 - k) * 14;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 2.2);
      ctx.font = Math.round(18 * (S.zoom / 3)) + 'px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(e.ch, x + 1, y + 1);
      ctx.fillStyle = '#fff2c8';
      ctx.fillText(e.ch, x, y);
      ctx.restore();
    }
  }

  // ---- 点同学：一个小的上下文菜单（DOM，跟着屏幕坐标走） ----
  var pmenuEl = null;
  function closePlayerMenu() {
    if (pmenuEl && pmenuEl.parentNode) pmenuEl.parentNode.removeChild(pmenuEl);
    pmenuEl = null;
  }

  function openPlayerMenu(p, sx, sy) {
    closePlayerMenu();
    var box = el('div', 'sg5-pmenu sg5-frame');
    box.appendChild(el('div', 'sg5-pmenu-name', p.name || '旅人'));
    var inParty = S.party && S.party.members && S.party.members.some(function (m) { return m[0] === p.id; });

    if (!inParty) {
      box.appendChild(uiBtn('邀请组队', 'sg5-btn-sm', function () {
        apiInvite(p.id); closePlayerMenu();
      }));
    }
    if (p.down && inParty) {
      box.appendChild(uiBtn('扶起他', 'sg5-btn-sm', function () {
        apiRevive(p.id); closePlayerMenu();
      }));
    }
    var row = el('div', 'sg5-pmenu-emotes');
    EMOTE_SET.forEach(function (e) {
      var b = el('button', 'sg5-emote-btn', e.ch);
      b.type = 'button';
      b.setAttribute('title', e.name);
      b.addEventListener('click', function () { apiEmote(e.id); closePlayerMenu(); }, false);
      row.appendChild(b);
    });
    box.appendChild(row);
    if (S.party && inParty) {
      box.appendChild(uiBtn('退出队伍', 'sg5-btn-sm sg5-btn-ghost', function () {
        apiLeaveParty(); closePlayerMenu();
      }));
    }
    UI.hud.appendChild(box);
    var w = 190;
    var left = clamp(sx - w / 2, 8, S.view.w - w - 8);
    var top = clamp(sy - 10, 8, S.view.h - 180);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    pmenuEl = box;
  }

  function hitPlayer(sx, sy) {
    var wx = s2wX(sx) / TILE, wy = s2wY(sy) / TILE;
    var best = null, bd = 1.2;
    for (var id in S.players) {
      var p = S.players[id];
      var d = dist(wx, wy, p.x, p.y + 0.4);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function bindPlayerClick(canvas, root, onDestroy) {
    var onTap = function (e) {
      var rect = canvas.getBoundingClientRect();
      var sx, sy;
      if (e.changedTouches && e.changedTouches.length) {
        sx = e.changedTouches[0].clientX - rect.left;
        sy = e.changedTouches[0].clientY - rect.top;
      } else {
        sx = e.clientX - rect.left;
        sy = e.clientY - rect.top;
      }
      var p = hitPlayer(sx, sy);
      if (p) openPlayerMenu(p, sx, sy);
      else closePlayerMenu();
    };
    canvas.addEventListener('click', onTap, false);
    onDestroy(function () { canvas.removeEventListener('click', onTap); });
  }

  // ---- 潮汐开场卡 ----
  function showChapterTide(zoneName, boss) {
    if (!UI.chEl) return;
    UI.chTitle.textContent = '长夜潮汐 · ' + zoneName;
    UI.chText.textContent = '雾从地面翻上来，比夜更黑。' +
      (boss ? '「' + boss + '」走在最前面 —— 它身后是整片长夜。' : '') +
      '到场的人一起守灯，撑到最后的人按贡献分星屑。灯灭之前，别退。';
    UI.chEl.className = 'sg5-chapter is-on';
    auSfx('alert', 0.55, 0.9);
    setTimeout(function () { UI.chEl.className = 'sg5-chapter'; }, 5200);
  }

  // ---- 支线面板（NPC 对话里展开） ----
  function questBlock(qid) {
    var q = (S.questDefs || {})[qid];
    var st = (S.quests || {})[qid];
    if (!q || !st) return null;
    var box = el('div', 'sg5-quest');
    var head = el('div', 'sg5-quest-head');
    head.appendChild(el('span', 'sg5-quest-name', q.name));
    head.appendChild(el('span', 'sg5-quest-step', '第 ' + Math.min(st.step + 1, q.steps.length) + ' / ' + q.steps.length + ' 步'));
    box.appendChild(head);
    if (st.done) {
      box.appendChild(el('div', 'sg5-quest-say', '「这条线走完了。你比我想的能扛。」'));
    } else {
      var step = q.steps[st.step];
      box.appendChild(el('div', 'sg5-quest-say', '「' + step.say + '」'));
      var prog = el('div', 'sg5-quest-prog');
      var fill = el('i');
      var f = clamp(st.prog / (st.need || 1), 0, 1);
      fill.style.transform = 'scaleX(' + f.toFixed(3) + ')';
      prog.appendChild(fill);
      box.appendChild(prog);
      box.appendChild(el('div', 'sg5-quest-num', st.prog + ' / ' + st.need + (step.type === 'mats' ? '（材料）' : (step.type === 'kill' ? '（击杀）' : '（灯塔）'))));
      var b = uiBtn(st.ready ? '交付' : '还差一点', 'sg5-btn-sm', function () { apiQuest(qid); });
      b.disabled = !st.ready;
      box.appendChild(b);
    }
    return box;
  }
