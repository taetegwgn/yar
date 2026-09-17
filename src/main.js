import * as d3 from 'd3';
import { createIcons, Network, Check, Download, Moon, SlidersHorizontal, Orbit, ChevronDown, Plus, Search, ArrowUpRight, PanelLeft, Scan, Sparkles, Mic, ArrowUp, Minus, Pause, Play, X, Eye, Trash2, Users, Copy, LogOut } from 'lucide';
import { getConnections } from './gemini.js';
import { addThought, ensureConnected, restoreGraph } from './graph-state.js';
import { RoomClient, savedRooms } from './rooms-client.js';
import './style.css';

const icons = { Network, Check, Download, Moon, SlidersHorizontal, Orbit, ChevronDown, Plus, Search, ArrowUpRight, PanelLeft, Scan, Sparkles, Mic, ArrowUp, Minus, Pause, Play, X, Eye, Trash2, Users, Copy, LogOut };
const $ = s => document.querySelector(s);
const icon = name => `<i data-lucide="${name}"></i>`;
const button = (id, name, title) => `<button id="${id}" class="icon-btn" aria-label="${title}" title="${title}">${icon(name)}</button>`;
const safe = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { notify('브라우저 저장 공간을 사용할 수 없습니다. 그래프를 내보내 주세요.'); } };
let state = restoreGraph(read('ieum.graph', null));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let apiKey = read('ieum.key', ''), theme = read('ieum.theme', 'light'), threshold = read('ieum.threshold', 0.5);
let selected = null, busy = false, hovered = null, transform = d3.zoomIdentity, paused = false, activeSidebarTab = 'nodes';
let controller;
let sharedRoom = null, roomStatus = 'local', roomBusy = false, confirmedRevision = null;
const rooms = new RoomClient({ onSnapshot: applyRoomSnapshot, onStatus: setRoomStatus, onWarning: notify });
document.documentElement.dataset.theme = theme;
$('#app').innerHTML = `
  <header><a class="brand" href="/" aria-label="야르렁소리 홈">${icon('network')}<span>야르렁소리<span class="brand-dot">.</span></span><small>생각의 연결</small></a><div class="header-right"><span class="saved">${icon('check')} 로컬 저장</span><button id="room-menu" class="room-button">${icon('users')}<span>공유 방</span></button>${button('export','download','그래프 내보내기')}${button('theme','moon','테마 전환')}${button('settings','sliders-horizontal','설정')}</div></header>
  <div class="workspace"><aside class="sidebar"><div class="space-heading"><span>내 작업 공간</span><span id="room-role" class="mono">LOCAL</span></div><button class="workspace-link">${icon('orbit')}<span id="space-name">생각의 지도</span>${icon('chevron-down')}</button><div class="sidebar-title"><div class="sidebar-tabs" role="tablist" aria-label="작업 공간 정보"><button type="button" role="tab" data-sidebar-tab="nodes" aria-selected="true">생각 <b id="list-count"></b></button><button type="button" role="tab" data-sidebar-tab="members" aria-selected="false" id="members-tab" hidden>${icon('users')} 참여자 <b id="members-count"></b></button></div>${button('clear','trash-2','전체 삭제')}</div><div id="thoughts-panel" role="tabpanel"><div class="search">${icon('search')}<input id="search" aria-label="생각 검색" placeholder="생각 검색"></div><div id="node-list"></div></div><div id="members-panel" role="tabpanel" hidden><div id="member-list"></div></div><div class="sidebar-bottom"><span class="tiny-label">CONNECTION ENGINE</span><button id="engine"><span class="status-dot"></span><span id="engine-label"></span>${icon('arrow-up-right')}</button><span class="engine-note">Gemini 2.5 Flash</span></div></aside>
  <main><div class="canvas-heading"><div class="eyebrow">MY KNOWLEDGE GRAPH</div><h1>생각의 지도</h1><div class="graph-meta"><span id="node-count"></span><span class="separator">/</span><span id="edge-count"></span><span id="member-count" hidden></span></div></div><div class="top-actions">${button('toggle-list','panel-left','생각 목록')}${button('fit','scan','전체 보기')}</div>
  <svg id="graph" aria-label="생각 연결 그래프"><g class="world"><g class="edges"></g><g class="nodes"></g></g></svg>
  <div id="empty" hidden><span>첫 번째 생각을 남겨보세요.</span></div>
  <section id="detail" hidden aria-label="선택한 생각"></section>
  <div class="bottom-area"><div id="activity" role="status"><span class="activity-dot"></span><span id="activity-text">생각과 생각 사이, 새로운 발견</span></div><form id="composer"><span class="input-spark">${icon('sparkles')}</span><input id="thought" placeholder="지금 떠오르는 생각은 무엇인가요?" aria-label="새로운 생각" maxlength="160" autocomplete="off">${button('mic','mic','음성 입력')}<button id="submit" class="primary" aria-label="생각 추가">${icon('arrow-up')}</button></form><div class="composer-footer"><span id="mode-note">체험 모드</span><span><span id="char-count">0</span> / 160</span></div></div>
  <div class="canvas-footer"><span><span class="legend-dot"></span> 생각 <span class="legend-line"></span> 의미 연결</span><div class="zoom-controls">${button('zoom-out','minus','축소')}<span id="zoom-level" class="mono">100%</span>${button('zoom-in','plus','확대')}<span class="control-divider"></span>${button('pause','pause','움직임 일시 정지')}</div></div></main></div>
  <div id="toast" role="status" hidden></div>
  <dialog id="settings-dialog"><form id="settings-form"><div class="modal-heading"><div><span class="eyebrow">PREFERENCES</span><h2>연결 설정</h2></div>${button('close-settings','x','설정 닫기')}</div><div id="personal-api"><label for="api-key">Google Gemini API 키</label><div class="key-field"><input id="api-key" type="password" autocomplete="off" placeholder="API 키를 입력하세요">${button('show-key','eye','API 키 표시')}</div><p>키는 이 브라우저에 저장됩니다. 분석할 생각과 기존 생각 목록은 Google로 전송됩니다. 개인 키만 사용하세요.</p><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio에서 키 발급 ${icon('arrow-up-right')}</a></div><p id="shared-api" hidden></p><div class="range-label"><label for="threshold">의미 연결 기준</label><output id="threshold-value"></output></div><input id="threshold" type="range" min="0.3" max="0.9" step="0.05"><p>기준보다 약한 최인접 연결은 점선으로 표시합니다.</p><div class="modal-actions"><button type="button" id="remove-key" class="text-btn">키 삭제</button><button type="submit" class="primary">설정 저장 ${icon('check')}</button></div></form></dialog>
  <dialog id="clear-dialog" aria-labelledby="clear-title"><h2 id="clear-title">모든 생각을 삭제할까요?</h2><p id="clear-summary"></p><p id="clear-description">이 브라우저의 그래프가 비워집니다. 삭제 후에는 되돌릴 수 없습니다.</p><div class="modal-actions"><button id="cancel-clear" class="text-btn" autofocus>취소</button><button id="confirm-clear" class="primary">전체 삭제</button></div></dialog>
  <dialog id="room-dialog" aria-labelledby="room-title"><div class="modal-heading"><div><span class="eyebrow">SHARED SPACE</span><h2 id="room-title">함께 만드는 생각의 지도</h2></div>${button('close-room','x','공유 방 닫기')}</div>
    <div id="room-current" hidden><h3 id="current-room-name"></h3><p id="current-room-info"></p><label for="invite-link">초대 링크</label><div class="key-field"><input id="invite-link" readonly aria-label="초대 링크">${button('copy-invite','copy','초대 링크 복사')}</div><p id="host-notice"></p><button id="leave-room" class="text-btn">${icon('log-out')} 개인 공간으로 돌아가기</button></div>
    <div id="room-entry"><form id="create-room-form"><label for="nickname">닉네임</label><input id="nickname" class="room-input" maxlength="30" value="참여자" required autocomplete="nickname"><label for="room-name">방 이름</label><input id="room-name" class="room-input" maxlength="60" placeholder="함께 나누는 생각" required><button class="primary" type="submit">${icon('plus')} 방 만들기</button></form>
    <form id="join-room-form"><label for="room-link">초대 링크 또는 방 ID</label><input id="room-link" class="room-input" required placeholder="초대 링크 붙여넣기"><button class="text-btn" type="submit">${icon('users')} 참여하기</button></form><div id="recent-rooms"></div></div><p id="room-error" role="alert" hidden></p>
  </dialog>`;

function refreshIcons() { createIcons({ icons, attrs: { 'stroke-width': 1.65 } }); document.querySelectorAll('button:not([type])').forEach(b => b.type = b.id === 'submit' ? 'submit' : 'button'); }
function notify(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => $('#toast').hidden = true, 4500); }
const idOf = n => typeof n === 'object' ? n.id : n;
function persist() { if(sharedRoom)return; write('ieum.graph', { nodes: state.nodes.map(({id,label,x,y,status})=>({id,label,x,y,status})), edges: state.edges.map(e=>({...e,source:idOf(e.source),target:idOf(e.target)})) }); }
function related(id) { return new Set(state.edges.filter(e=>idOf(e.source)===id || idOf(e.target)===id).flatMap(e=>[idOf(e.source),idOf(e.target)])); }
function memberFor(node) { return sharedRoom?.members?.find(member => member.id === node.authorId); }
function memberColor(node) { return memberFor(node)?.color || 'var(--muted)'; }
const svg = d3.select('#graph'), world = svg.select('.world');
const simulation = d3.forceSimulation(state.nodes).force('link',d3.forceLink(state.edges).id(d=>d.id).distance(d=>115+(1-d.weight)*110).strength(0.35)).force('charge',d3.forceManyBody().strength(-450)).force('collide',d3.forceCollide().radius(d=>Math.min(65,22+d.label.length*3))).force('x',d3.forceX(0).strength(0.025)).force('y',d3.forceY(0).strength(0.035));
const zoom = d3.zoom().scaleExtent([0.2,3]).on('zoom', e=>{transform=e.transform;world.attr('transform',transform);$('#zoom-level').textContent=`${Math.round(transform.k*100)}%`;});
svg.call(zoom).on('dblclick.zoom',null).on('click',()=>{selected=null;updateHighlight();renderDetail();});
function fit() { const box=$('#graph').getBoundingClientRect(); const xs=state.nodes.map(n=>n.x||0), ys=state.nodes.map(n=>n.y||0); const w=Math.max(550,(d3.max(xs) ?? 0)-(d3.min(xs) ?? 0)+180),h=Math.max(430,(d3.max(ys) ?? 0)-(d3.min(ys) ?? 0)+130); const scale=Math.min(1, (box.width-50)/w,(box.height-240)/h); svg.transition().duration(400).call(zoom.transform,d3.zoomIdentity.translate(box.width/2,box.height*0.47).scale(Math.max(0.2,scale))); }
function selectNode(n) { selected=n.id; updateHighlight();renderDetail();renderList(); }
function updateHighlight() { const active=hovered||selected, neighbors=related(active); svg.selectAll('.node').classed('dimmed',d=>active && d.id!==active && !neighbors.has(d.id)).classed('selected',d=>d.id===active);svg.selectAll('.edge').classed('dimmed',d=>active && idOf(d.source)!==active && idOf(d.target)!==active).classed('active',d=>active && (idOf(d.source)===active||idOf(d.target)===active)); }
function renderGraph() {
  if(!sharedRoom)ensureConnected(state);
  svg.select('.edges').selectAll('line').data(state.edges,d=>`${idOf(d.source)}-${idOf(d.target)}`).join('line').attr('class','edge').attr('stroke-width',d=>0.6+d.weight*1.6).attr('stroke-dasharray',d=>d.weight<=threshold?'4 5':null);
  const nodes=svg.select('.nodes').selectAll('g').data(state.nodes,d=>d.id).join(enter=>{const g=enter.append('g').attr('class','node');g.append('circle').attr('class','halo').attr('r',0).transition().duration(reducedMotion?0:550).attr('r',19);g.append('circle').attr('class','core').attr('r',0).transition().duration(reducedMotion?0:550).ease(d3.easeBackOut.overshoot(2.5)).attr('r',6);if(!reducedMotion)g.append('circle').attr('class','entry-ring').attr('r',6).transition().duration(750).attr('r',34).style('opacity',0).remove();g.append('text').attr('text-anchor','middle').attr('y',26);g.append('title');return g;});
  nodes.attr('role','button').attr('tabindex',0).attr('aria-label',d=>d.label).on('keydown',(e,d)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectNode(d);}}).on('click',(e,d)=>{e.stopPropagation();selectNode(d);}).on('mouseenter',(e,d)=>{hovered=d.id;updateHighlight();}).on('mouseleave',()=>{hovered=null;updateHighlight();}).call(d3.drag().on('start',(e,d)=>{if(!e.active&&!paused) simulation.alphaTarget(0.2).restart();d.fx=d.x;d.fy=d.y;}).on('drag',(e,d)=>{d.fx=e.x;d.fy=e.y;if(paused){d.x=e.x;d.y=e.y;tick();}}).on('end',(e,d)=>{simulation.alphaTarget(0);d.fx=null;d.fy=null;persist();}));
  nodes.style('--node-color',d=>sharedRoom?memberColor(d):null).select('text').text(d=>d.label.length>18?d.label.slice(0,18)+'…':d.label);nodes.select('title').text(d=>sharedRoom?`${d.label} · ${memberFor(d)?.name || '알 수 없는 참여자'}`:d.label);nodes.classed('pending',d=>d.status==='pending').classed('failed',d=>d.status==='failed');
  simulation.nodes(state.nodes);simulation.force('link').links(state.edges);if(!paused)simulation.alpha(0.55).restart();tick();updateHighlight();
  $('#node-count').textContent=`${state.nodes.length}개의 생각`;$('#edge-count').textContent=`${state.edges.length}개의 연결`;$('#list-count').textContent=state.nodes.length;$('#empty').hidden=state.nodes.length>0;$('#clear').hidden=!!sharedRoom&&sharedRoom.me.role!=='host';$('#clear').disabled=busy||roomBusy||!state.nodes.length||(sharedRoom&&roomStatus!=='connected');renderList();renderMembers();renderDetail();persist();
}
function tick(){svg.selectAll('.edge').attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);svg.selectAll('.node').attr('transform',d=>`translate(${d.x},${d.y})`);}
simulation.on('tick',tick).on('end',persist);
function renderList(){ const query=$('#search').value.trim().toLowerCase();$('#node-list').innerHTML=state.nodes.filter(n=>n.label.toLowerCase().includes(query)).map(n=>`<button class="list-item ${selected===n.id?'is-selected':''}" data-id="${safe(n.id)}"><span class="list-dot" style="background:${safe(memberColor(n))}"></span><span>${safe(n.label)}</span><small>${related(n.id).size ? related(n.id).size-1:0}</small></button>`).join('')||'<p class="list-empty">생각이 없습니다.</p>';$('#node-list').querySelectorAll('button').forEach(b=>b.onclick=()=>{selectNode(state.nodes.find(n=>n.id===b.dataset.id));$('.sidebar').classList.remove('mobile-open');}); }
function renderMembers(){const tab=$('#members-tab');tab.hidden=!sharedRoom;if(!sharedRoom){$('#members-panel').hidden=true;return;}$('#members-count').textContent=sharedRoom.members.length;$('#member-list').innerHTML=sharedRoom.members.map(member=>`<button class="member-item" data-member-id="${safe(member.id)}"><span class="member-swatch" style="background:${safe(member.color)}"></span><span class="member-name">${safe(member.name)}</span>${member.role==='host'?'<span class="member-role">방장</span>':''}<small>${member.nodeCount}</small></button>`).join('');$('#member-list').querySelectorAll('button').forEach(button=>button.onclick=()=>{const member=sharedRoom.members.find(item=>item.id===button.dataset.memberId);const authored=state.nodes.filter(node=>node.authorId===member.id);if(!authored.length)return notify(`${member.name} 님이 작성한 생각이 아직 없습니다.`);selectNode(authored.at(-1));activeSidebarTab='nodes';updateSidebarTab();$('.sidebar').classList.remove('mobile-open');});}
function updateSidebarTab(){const isMembers=activeSidebarTab==='members'&&!!sharedRoom;$('#thoughts-panel').hidden=isMembers;$('#members-panel').hidden=!isMembers;document.querySelectorAll('[data-sidebar-tab]').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.sidebarTab===activeSidebarTab)));}
function renderDetail(){const n=state.nodes.find(n=>n.id===selected);$('#detail').hidden=!n;if(!n)return;const edges=state.edges.filter(e=>idOf(e.source)===n.id||idOf(e.target)===n.id).sort((a,b)=>b.weight-a.weight);const author=memberFor(n);$('#detail').innerHTML=`<div class="detail-heading"><span class="tiny-label">선택한 생각</span>${button('close-detail','x','선택 닫기')}</div><h2>${safe(n.label)}</h2><div class="detail-sub">${edges.length}개의 연결</div>${author?`<div class="author-chip"><span class="member-swatch" style="background:${safe(author.color)}"></span><span>${safe(author.name)}</span>${author.role==='host'?'<small>방장</small>':''}</div>`:''}<div class="detail-connections">${edges.map(e=>{const other=state.nodes.find(v=>v.id===(idOf(e.source)===n.id?idOf(e.target):idOf(e.source)));return `<div><span>${safe(other.label)}</span><span class="mono">${e.kind==='provisional'?'분석 전':`${Math.round(e.weight*100)}%${e.weight<=threshold?' · 약함':''}`}</span></div>`;}).join('')}</div>${n.status==='failed'||n.status==='local'?'<button id="retry" class="text-btn">다시 분석</button>':''}<button id="delete-node" class="text-btn delete">${icon('trash-2')} 생각 삭제</button>`;refreshIcons();$('#close-detail').onclick=()=>{selected=null;renderDetail();updateHighlight();renderList();};$('#delete-node').onclick=()=>{if(sharedRoom)return deleteShared(n.id);if(busy)return notify('분석이 끝난 후 삭제해 주세요.');state.nodes=state.nodes.filter(v=>v.id!==n.id);state.edges=state.edges.filter(e=>idOf(e.source)!==n.id&&idOf(e.target)!==n.id);selected=null;renderGraph();};if(sharedRoom){const canEdit=sharedRoom.me.role==='host'||sharedRoom.me.id===n.authorId;$('#delete-node').hidden=!canEdit;if($('#retry'))$('#retry').hidden=!canEdit||!sharedRoom.aiEnabled;$('.detail-sub').textContent=`${edges.length}개의 연결 · ${n.authorName}`;}if($('#retry'))$('#retry').onclick=()=>sharedRoom?analyzeShared(n.id):analyze(n); }
function syncMode() { if(sharedRoom){$('#engine-label').textContent=sharedRoom.aiEnabled?'공유 Gemini 연결':'공유 · 임시 연결';$('#mode-note').textContent=sharedRoom.aiEnabled?'공유 방 · 서버에서 의미 분석':'공유 방 · 서버 Gemini 키 미설정';$('#engine .status-dot').classList.toggle('connected',sharedRoom.aiEnabled);return;} $('#engine-label').textContent=apiKey?'Gemini 키 저장됨':'체험 모드';$('#mode-note').textContent=apiKey?'Gemini로 의미 연결 · 점선은 약한 연결 또는 분석 전':'체험 모드 · 점선은 분석 전 임시 연결';$('#engine .status-dot').classList.toggle('connected',!!apiKey); }
async function analyze(n){if(busy)return;if(!apiKey){openSettings();return;}busy=true;$('#submit').disabled=true;n.status='pending';$('#activity').classList.add('thinking');$('#activity-text').textContent='생각 사이의 연결을 찾고 있어요';renderGraph();controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);try{const others=state.nodes.filter(v=>v.id!==n.id);const matches=await getConnections(n.label,others,apiKey,controller.signal);state.edges=state.edges.filter(e=>idOf(e.source)!==n.id && !(e.kind==='provisional' && idOf(e.target)===n.id));const strong=matches.filter(e=>e.weight>threshold);const chosen=strong.length?strong:matches.sort((a,b)=>b.weight-a.weight).slice(0,1);state.edges.push(...chosen.map(e=>({source:n.id,target:e.id,weight:e.weight,kind:'gemini'})));n.status='done';$('#activity-text').textContent=`새로운 연결 ${chosen.length}개를 발견했어요`;}catch(error){n.status='failed';$('#activity-text').textContent='분석하지 못했어요 · 임시 연결 유지, 생각을 선택해 재시도';notify(error.name==='AbortError'?'응답 시간이 초과되었습니다. 다시 시도해 주세요.':error.message);}finally{clearTimeout(timeout);busy=false;$('#submit').disabled=false;$('#activity').classList.remove('thinking');renderGraph();}}
$('#composer').onsubmit=e=>{e.preventDefault();if(sharedRoom)return submitShared();const label=$('#thought').value.trim();if(!label||busy)return;if(state.nodes.length>=200)return notify('그래프당 최대 200개의 생각을 기록할 수 있습니다.');const duplicate=state.nodes.find(n=>n.label.toLowerCase()===label.toLowerCase());if(duplicate){selectNode(duplicate);return notify('이미 기록한 생각입니다.');}const n={id:crypto.randomUUID(),label,x:transform.invert([$('#graph').clientWidth/2,$('#graph').clientHeight*0.47])[0]+(Math.random()-0.5)*40,y:transform.invert([$('#graph').clientWidth/2,$('#graph').clientHeight*0.47])[1]+(Math.random()-0.5)*40,status:'local'};addThought(state,n);$('#thought').value='';$('#char-count').textContent='0';renderGraph();if(apiKey)analyze(n);else{$('#activity-text').textContent=state.nodes.length===1?'첫 번째 생각을 기록했어요':'임시 연결을 만들었어요 · 의미 분석은 API 키 연결 후 가능';} };
$('#thought').oninput=()=>$('#char-count').textContent=$('#thought').value.length;
$('#search').oninput=renderList;
function openSettings(){$('#personal-api').hidden=!!sharedRoom;$('#remove-key').hidden=!!sharedRoom;$('#shared-api').hidden=!sharedRoom;if(sharedRoom)$('#shared-api').textContent=sharedRoom.aiEnabled?'이 방은 서버의 Gemini 키를 사용합니다. 연결 기준은 이 화면에만 적용됩니다.':'이 방은 임시 연결로 표시됩니다. 서비스 운영자가 서버에 Gemini 키를 설정하면 의미 분석을 사용할 수 있습니다.';$('#api-key').value=apiKey;$('#threshold').value=threshold;$('#threshold-value').textContent=`${Math.round(threshold*100)}%`;$('#settings-dialog').showModal();}
$('#settings').onclick=openSettings;$('#engine').onclick=openSettings;$('#close-settings').onclick=()=>$('#settings-dialog').close();$('#show-key').onclick=()=>{$('#api-key').type=$('#api-key').type==='password'?'text':'password';};$('#threshold').oninput=()=>$('#threshold-value').textContent=`${Math.round($('#threshold').value*100)}%`;
$('#settings-form').onsubmit=e=>{e.preventDefault();if(sharedRoom){threshold=Number($('#threshold').value);write('ieum.threshold',threshold);renderGraph();$('#settings-dialog').close();return;}apiKey=$('#api-key').value.trim();threshold=Number($('#threshold').value);write('ieum.key',apiKey);write('ieum.threshold',threshold);syncMode();renderGraph();$('#settings-dialog').close();notify('설정을 저장했습니다.');const pending=state.nodes.find(n=>n.id===selected && (n.status==='local'||n.status==='failed'))||state.nodes.findLast(n=>n.status==='local'||n.status==='failed');if(apiKey&&pending&&!busy)analyze(pending);};$('#remove-key').onclick=()=>{$('#api-key').value='';apiKey='';write('ieum.key','');syncMode();notify('저장된 API 키를 삭제했습니다.');};
$('#theme').onclick=()=>{theme=theme==='light'?'dark':'light';document.documentElement.dataset.theme=theme;write('ieum.theme',theme);};
$('#fit').onclick=fit;$('#zoom-in').onclick=()=>svg.transition().duration(200).call(zoom.scaleBy,1.25);$('#zoom-out').onclick=()=>svg.transition().duration(200).call(zoom.scaleBy,0.8);$('#pause').onclick=()=>{paused=!paused;if(paused)simulation.stop();else simulation.alpha(0.3).restart();$('#pause').innerHTML=icon(paused?'play':'pause');$('#pause').setAttribute('aria-label',paused?'움직임 재개':'움직임 일시 정지');$('#pause').title=paused?'움직임 재개':'움직임 일시 정지';refreshIcons();};
document.querySelectorAll('[data-sidebar-tab]').forEach(tab=>tab.onclick=()=>{activeSidebarTab=tab.dataset.sidebarTab;updateSidebarTab();});
$('#toggle-list').onclick=()=>$('.sidebar').classList.toggle('mobile-open');$('.workspace-link').onclick=()=>{$('#search').value='';renderList();fit();};
$('#clear').onclick=()=>{if(sharedRoom&&sharedRoom.me.role!=='host')return notify('전체 삭제는 방장만 할 수 있습니다.');if(roomBusy)return;if(sharedRoom){confirmedRevision=sharedRoom.revision;$('#clear-description').textContent='모든 참여자의 생각과 연결이 삭제됩니다. 삭제 후에는 되돌릴 수 없습니다.';}else{$('#clear-description').textContent='이 브라우저의 그래프가 비워집니다. 삭제 후에는 되돌릴 수 없습니다.';}if(busy)return notify('분석이 끝난 후 삭제해 주세요.');if(!state.nodes.length)return notify('삭제할 생각이 없습니다.');$('#clear-summary').textContent=`생각 ${state.nodes.length}개와 연결 ${state.edges.length}개를 삭제합니다.`;$('#clear-dialog').showModal();};
$('#cancel-clear').onclick=()=>$('#clear-dialog').close();
$('#confirm-clear').onclick=()=>{if(sharedRoom)return clearShared();if(busy)return notify('분석이 끝난 후 삭제해 주세요.');state={nodes:[],edges:[]};selected=null;hovered=null;$('#search').value='';$('#activity-text').textContent='첫 번째 생각을 남겨보세요.';renderGraph();fit();$('#clear-dialog').close();$('.sidebar').classList.remove('mobile-open');$('#thought').focus();notify('모든 생각과 연결을 삭제했습니다.');};
$('#export').onclick=()=>{persist();const blob=new Blob([JSON.stringify({version:1,nodes:state.nodes.map(({id,label,x,y,status})=>({id,label,x,y,status})),edges:state.edges.map(e=>({...e,source:idOf(e.source),target:idOf(e.target)}))},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='yarureong-graph.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('그래프를 내보냈습니다.');};
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(SpeechRecognition){const recognition=new SpeechRecognition();recognition.lang='ko-KR';recognition.interimResults=false;let listening=false;$('#mic').onclick=()=>{if(listening){recognition.stop();return;}try{recognition.start();}catch{notify('음성 입력을 시작할 수 없습니다.');}};recognition.onstart=()=>{listening=true;$('#mic').classList.add('listening');};recognition.onend=()=>{listening=false;$('#mic').classList.remove('listening');};recognition.onresult=e=>{$('#thought').value=e.results[0][0].transcript.slice(0,160);$('#thought').dispatchEvent(new Event('input'));$('#thought').focus();};recognition.onerror=()=>notify('마이크 권한과 음성 인식 연결을 확인해 주세요.');}else{$('#mic').disabled=true;$('#mic').title='이 브라우저는 음성 입력을 지원하지 않습니다.';}
refreshIcons();syncMode();renderGraph();simulation.tick(100);tick();fit();new ResizeObserver(()=>fit()).observe($('main'));window.addEventListener('pagehide',persist);
if(matchMedia('(prefers-reduced-motion: reduce)').matches){paused=true;simulation.stop();$('#pause').innerHTML=icon('play');refreshIcons();}

function setRoomStatus(status) {
  roomStatus = status;
  const labels = { connected: '공유 동기화', offline: '재연결 중', expired: '참여 인증 만료', local: '로컬 저장' };
  $('.saved').innerHTML = icon(status === 'connected' || status === 'local' ? 'check' : 'orbit') + ' ' + labels[status];
  updateRoomControls();
  refreshIcons();
}
function updateRoomControls() {
  $('#submit').disabled = busy || roomBusy || (!!sharedRoom && roomStatus !== 'connected');
  $('#thought').disabled = roomBusy || (!!sharedRoom && roomStatus !== 'connected');
  $('#clear').hidden = !!sharedRoom && sharedRoom.me.role !== 'host';
  $('#clear').disabled = busy || roomBusy || !state.nodes.length || (!!sharedRoom && roomStatus !== 'connected');
  $('#room-menu').disabled = busy || roomBusy;
}
function applyRoomSnapshot(snapshot) {
  const previous = sharedRoom;
  if (previous?.id === snapshot.id && previous.revision >= snapshot.revision) return;
  const sameRoom = previous?.id === snapshot.id;
  const positions = new Map(sameRoom ? state.nodes.map(n => [n.id, n]) : []);
  const center = transform.invert([$('#graph').clientWidth / 2, $('#graph').clientHeight * 0.47]);
  sharedRoom = snapshot;
  state = {
    nodes: snapshot.nodes.map(n => ({ ...n, x: positions.get(n.id)?.x ?? center[0] + (Math.random() - 0.5) * 70, y: positions.get(n.id)?.y ?? center[1] + (Math.random() - 0.5) * 70, vx: positions.get(n.id)?.vx ?? 0, vy: positions.get(n.id)?.vy ?? 0 })),
    edges: snapshot.edges.map(e => ({ ...e }))
  };
  if (!state.nodes.some(n => n.id === selected)) selected = null;
  hovered = null;
  $('#space-name').textContent = snapshot.name;
  $('h1').textContent = snapshot.name;
  $('#room-role').textContent = snapshot.me.role === 'host' ? '방장' : '참여자';
  $('#member-count').hidden = false;
  $('#member-count').textContent = `참여자 ${snapshot.memberCount}명`;
  if (sameRoom && previous.generation !== snapshot.generation) {
    $('#activity-text').textContent = '방장이 모든 생각을 삭제했습니다.';
    $('#clear-dialog').close();
    $('#search').value = '';
  } else if (sameRoom && snapshot.nodes.length > previous.nodes.length) {
    $('#activity-text').textContent = `${snapshot.nodes.at(-1).authorName} 님의 생각이 추가됐어요`;
  } else if (!sameRoom) $('#activity-text').textContent = `${snapshot.me.name} 님, 함께 생각을 남겨보세요.`;
  syncMode();
  renderGraph();
  updateSidebarTab();
  if (!sameRoom) { simulation.tick(60); tick(); fit(); }
  updateRoomControls();
}
async function runShared(action) {
  if (roomBusy || busy || roomStatus !== 'connected') return;
  roomBusy = true; updateRoomControls();
  try { return await action(); }
  catch (error) { notify(error.message); await rooms.sync(); }
  finally { roomBusy = false; updateRoomControls(); }
}
async function submitShared() {
  const label = $('#thought').value.trim();
  if (!label) return;
  const id = crypto.randomUUID();
  const generation = sharedRoom.generation;
  const result = await runShared(() => rooms.action('/nodes', { id, label, generation }));
  if (!result) return;
  $('#thought').value = ''; $('#char-count').textContent = '0';
  $('#thought').focus();
  if (sharedRoom.aiEnabled) await analyzeShared(id);
}
async function analyzeShared(id) {
  await runShared(async () => {
    $('#activity').classList.add('thinking');
    $('#activity-text').textContent = '생각 사이의 연결을 찾고 있어요';
    try {
      const result = await rooms.action('/analyze/' + id, {});
      $('#activity-text').textContent = result.warning || '의미 연결을 공유했습니다.';
      return result;
    } finally { $('#activity').classList.remove('thinking'); }
  });
}
async function deleteShared(id) {
  await runShared(() => rooms.action('/nodes/' + id, undefined, 'DELETE'));
}
async function clearShared() {
  if (sharedRoom.me.role !== 'host') return notify('전체 삭제는 방장만 할 수 있습니다.');
  const result = await runShared(() => rooms.action('/clear', { revision: confirmedRevision }));
  $('#clear-dialog').close();
  if (result) { $('#search').value = ''; fit(); $('#thought').focus(); notify('방의 모든 생각과 연결을 삭제했습니다.'); }
}
function roomIdFrom(value) {
  const raw = value.trim();
  if (/^[a-f0-9-]{36}$/.test(raw)) return raw;
  try { const id = new URL(raw).searchParams.get('room'); if (/^[a-f0-9-]{36}$/.test(id)) return id; } catch {}
  throw new Error('초대 링크 또는 방 ID를 확인해 주세요.');
}
function setRoomUrl(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('room', id); else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}
function roomDialog() {
  if (busy || roomBusy) return;
  $('#room-title').textContent = sharedRoom ? '공유 방' : '함께 만드는 생각의 지도';
  $('#room-error').hidden = true;
  $('#room-current').hidden = !sharedRoom;
  $('#room-entry').hidden = !!sharedRoom;
  if (sharedRoom) {
    $('#current-room-name').textContent = sharedRoom.name;
    $('#current-room-info').textContent = `${sharedRoom.me.name} · ${sharedRoom.me.role === 'host' ? '방장' : '참여자'} · 참여자 ${sharedRoom.memberCount}명`;
    $('#invite-link').value = `${location.origin}${location.pathname}?room=${sharedRoom.id}`;
    $('#host-notice').textContent = sharedRoom.me.role === 'host' ? '방장 인증은 이 브라우저에 저장됩니다. 브라우저 데이터를 삭제하면 방장 권한을 복구할 수 없습니다.' : '초대 링크로 참여한 방입니다. 전체 삭제는 방장만 할 수 있습니다.';
  } else {
    const saved = Object.entries(savedRooms());
    $('#recent-rooms').innerHTML = saved.length ? '<label>최근 참여한 방</label>' + saved.map(([id, room]) => `<button type="button" class="recent-room" data-room-id="${safe(id)}"><span>${safe(room.name)}</span><small>${room.role === 'host' ? '방장' : '참여자'}</small></button>`).join('') : '';
    $('#recent-rooms').querySelectorAll('button').forEach(b => b.onclick = () => roomOperation(() => rooms.resume(b.dataset.roomId)));
  }
  refreshIcons();
  $('#room-dialog').showModal();
}
async function roomOperation(operation) {
  if (roomBusy || busy) return;
  roomBusy = true;
  $('#room-error').hidden = true;
  $('#room-dialog').querySelectorAll('button').forEach(b => b.disabled = true);
  updateRoomControls();
  try {
    persist();
    await operation();
    setRoomUrl(sharedRoom.id);
    $('#room-dialog').close();
    $('.sidebar').classList.remove('mobile-open');
  } catch (error) {
    $('#room-error').textContent = error.message;
    $('#room-error').hidden = false;
  } finally {
    roomBusy = false;
    $('#room-dialog').querySelectorAll('button').forEach(b => b.disabled = false);
    updateRoomControls();
  }
}
$('#room-menu').onclick = roomDialog;
$('#close-room').onclick = () => { $('#room-dialog').close(); if (!sharedRoom) setRoomUrl(null); };
$('#room-dialog').addEventListener('cancel', e => { if (roomBusy) e.preventDefault(); else if (!sharedRoom) setRoomUrl(null); });
$('#create-room-form').onsubmit = e => {
  e.preventDefault();
  roomOperation(() => rooms.create($('#room-name').value.trim(), $('#nickname').value.trim()));
};
$('#join-room-form').onsubmit = e => {
  e.preventDefault();
  roomOperation(async () => {
    const id = roomIdFrom($('#room-link').value);
    if (!await rooms.resume(id)) await rooms.join(id, $('#nickname').value.trim());
  });
};
$('#copy-invite').onclick = async () => {
  try { await navigator.clipboard.writeText($('#invite-link').value); notify('초대 링크를 복사했습니다.'); }
  catch { $('#invite-link').select(); notify('링크를 선택했습니다. 복사해 주세요.'); }
};
$('#leave-room').onclick = () => {
  if (roomBusy || busy) return;
  rooms.stop(); sharedRoom = null; selected = null; hovered = null;
  state = restoreGraph(read('ieum.graph', null));
  setRoomUrl(null);
  $('#space-name').textContent = '생각의 지도'; $('h1').textContent = '생각의 지도';
  $('#room-role').textContent = 'LOCAL'; $('#member-count').hidden = true;
  $('#activity-text').textContent = '개인 공간으로 돌아왔습니다.';
  $('#search').value = '';
  setRoomStatus('local'); syncMode(); renderGraph(); fit();
  $('#room-dialog').close();
};
async function openInvitedRoom() {
  const id = new URL(location.href).searchParams.get('room');
  if (!id) return;
  roomDialog();
  $('#room-link').value = id;
  if (!/^[a-f0-9-]{36}$/.test(id)) {
    $('#room-error').textContent = '초대 링크가 올바르지 않습니다.'; $('#room-error').hidden = false; return;
  }
  if (savedRooms()[id]?.token) await roomOperation(() => rooms.resume(id));
  else { $('#nickname').focus(); $('#room-title').textContent = '초대받은 방에 참여하기'; }
}
openInvitedRoom();
