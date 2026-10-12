const devices={phone:[390,844,'TOUCH'],tablet:[1024,768,'TOUCH'],compact:[820,768,'TOUCH'],desktop:[1440,900,'MOUSE + KEYBOARD']};
const scenarios={
 complete:{model:'GPT-5',id:'gpt-5',effort:'high',effortDetail:'high（高）',basis:'最近一轮',source:'Codex · 本地会话记录',time:'今天 14:32:08 · 最近一轮',sub:'最近一轮的执行记录',explain:'这是最近一轮记录的值。若你刚在终端切换了模型，新一轮记录到达后才会更新。',title:'明确是「最近一轮」。',copy:'从会话日志读取到的值，只说明最近一轮的记录；不会冒充下一条消息的配置。'},
 partial:{model:'Claude Sonnet 4',id:'claude-sonnet-4-20250514',effort:'未提供',effortDetail:'未提供',basis:'最近一轮',source:'Claude · 本地回复记录',time:'今天 14:32:08 · 最近一轮',sub:'已识别模型，尚无思考强度',explain:'此会话记录没有提供 effort。思考内容和响应耗时不能说明所配置的档位。',title:'有多少证据，显示多少。',copy:'仅拿到模型时仍有价值。effort 明确标为未提供，不借用旧值，也不默认填 medium。'},
 unknown:{model:'模型未提供',id:'尚未收到此会话的模型记录',effort:'未提供',effortDetail:'尚无记录',basis:'尚无记录',source:'尚无可用来源',time:'—',sub:'等待此会话的模型信息',explain:'可能是新会话、旧版 daemon，或该 Agent 尚未提供此字段。你仍可正常阅读与发送消息。',title:'缺失也是一种正常状态。',copy:'不猜默认值、不报连接错误。副标题保留稳定高度，下一次记录到达时更新。'},
 offline:{model:'GPT-5',id:'gpt-5',effort:'high',effortDetail:'high（高）· 离线记录',basis:'离线记录',source:'Codex · 断连前的会话记录',time:'今天 14:32:08 · 断连前',sub:'连接中断，以下信息尚未重新核验',explain:'电脑连接已中断。这里保留的是断连前记录；重新连接并确认会话身份后更新。',title:'离线时，不假装实时。',copy:'保留最后记录供参考，明确标记离线。重连若发现 Agent 已更换，清空旧值。'},
 changed:{model:'GPT-5 mini',id:'gpt-5-mini',effort:'medium',effortDetail:'medium（中）',basis:'最近一轮',source:'Codex · 新一轮会话记录',time:'今天 14:36:21 · 新一轮',sub:'新一轮记录已更新',explain:'新一轮的模型和 effort 已更新。之前的回复不会被重新标成这个模型。',title:'收到新证据，再更新。',copy:'模拟下一轮记录到达：模型与 effort 一起更新。不会因为用户输入了切换命令就提前显示成功。'},
 reported:{model:'Claude Sonnet 4',id:'claude-sonnet-4-20250514',effort:'high',effortDetail:'high（高）',basis:'设置上报',source:'Claude · 已绑定会话的状态报告',time:'今天 14:36:21 · 报告仍在有效期内',sub:'Agent 最近上报的设置',explain:'这是 Agent 上报的设置，并非服务端实际路由证明。上报过期后取消此状态；没有新报告时不能宣称设置仍然有效。',title:'设置与执行记录分开说。',copy:'这个场景依赖后续报告接入。只有来源、会话身份与有效期都核验通过，才显示“设置上报”。'},
 long:{model:'provider/custom-reasoning-model-2026-extended',id:'provider/custom-reasoning-model-2026-extended',effort:'xhigh',effortDetail:'xhigh（原始档位）',basis:'最近一轮',source:'Agent · 本地会话记录（示例）',time:'今天 14:32:08 · 最近一轮',sub:'完整模型名称',explain:'未知模型按原始 ID 展示，副标题截断但详情保留完整名称。不会按名称猜测模型能力。',title:'长名称也不挤掉 effort。',copy:'模型名允许省略，思考档位保持可见。详情对完整 ID 自动换行。此模型 ID 为布局示例。'}
};
// Each preview represents one identified turn. No session-latest fallback.
Object.assign(scenarios.complete, {
  sub: '完成 3 步 · 用时 1 分 12 秒', time: '本轮记录 · 今天 14:32:08',
  title: '信息属于这轮回复。', copy: '模型和 effort 与用时同处一张执行卡片。这里不需要“上轮”标签，也不代表下一轮设置。',
  explain: '这是这轮回复的执行记录。后续切换模型不会改变这张卡片。',
});
Object.assign(scenarios.partial, {
  effort: 'effort 未提供', sub: '本轮记录仅包含模型',
  explain: '这轮回复记录了模型，但没有 effort；不能从上一轮或思考耗时推断。',
});
Object.assign(scenarios.unknown, {
  model: '模型未记录', sub: '本轮尚无模型记录',
  explain: '没有与这一轮绑定的模型记录。原来的执行步骤和用时仍可查看。',
  copy: '只显示“模型未记录”，不重复两个未知标签；卡片保持相同的两行结构。',
});
Object.assign(scenarios.offline, {
  effortDetail: 'high（高）', sub: '本轮已保存的执行记录',
  explain: '连接虽已中断，这轮已经记录的模型仍是历史事实。顶部单独展示连接状态。',
  title: '历史事实不随断连消失。', copy: '顶部显示连接中断，执行卡片保留本轮已确认的模型和 effort。',
});
Object.assign(scenarios.changed, {
  sub: '另一轮的执行记录', title: '每轮保存自己的模型。',
  copy: '此场景展示另一轮使用 GPT-5 mini / medium 的卡片；之前那轮的 GPT-5 / high 不会被改写。',
  explain: '这张卡片代表另一轮回复，其记录为 gpt-5-mini / medium；不回写之前的轮次。',
});
Object.assign(scenarios.reported, {
  model: '模型未记录', id: '无法确认这轮使用的模型', effort: '未提供', effortDetail: '未提供',
  sub: '会话级记录无法绑定到本轮', source: '只有会话级设置，缺少轮次关联', time: '—',
  title: '不把最新设置填进历史。', copy: '即使有会话级最新模型，只要不能确认属于这一轮，就不显示具体值。',
  explain: '现有信息只能说明会话设置，不能证明这一轮实际使用的模型。等待有轮次归属的记录。',
});
Object.assign(scenarios.long, { sub: '本轮的完整模型名称',
  copy: '只截断模型名称，用时和 effort 保持完整。点执行卡片可查看原始 ID。' });
// Existing bundled product marks, from agent-icons.ts (@lobehub/icons-static-svg, MIT).
const marks = {"codex": "<path d=\"M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z\"></path>", "claude": "<path d=\"M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z\" fill=\"#D97757\" fill-rule=\"nonzero\"></path>"};
const frame = document.getElementById('preview');
let device = 'phone';
let scenario = 'complete';
let keyboardSeen = false;

function fit() {
  const [width, height] = devices[device];
  const available = document.querySelector('.stage').clientWidth - (innerWidth < 760 ? 20 : 48);
  const scale = Math.min(1, available / width);
  const wrapper = document.getElementById('frame-wrap');
  wrapper.style.width = `${width * scale}px`;
  wrapper.style.height = `${height * scale}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.transform = `scale(${scale})`;
  document.getElementById('dimensions').textContent = `${width} × ${height} · ${devices[device][2]}`;
}

function render() {
  const doc = frame.contentDocument;
  if (!doc?.getElementById('model')) return;
  const state = scenarios[scenario];
  const fields = {
    model: state.model, effort: state.effort,
    'detail-model': state.id, 'detail-effort': state.effortDetail,
    'detail-source': state.source, 'detail-time': state.time,
    'detail-sub': state.sub, 'detail-explain': state.explain,
  };
  for (const [id, value] of Object.entries(fields)) doc.getElementById(id).textContent = value;
  doc.body.className = `${scenario}${keyboardSeen ? ' has-keyboard' : ''}${['unknown', 'reported'].includes(scenario) ? ' no-effort' : ''}`;
  const agent = scenario === 'partial' ? 'claude' : 'codex';
  doc.querySelector('.avatar svg').innerHTML = marks[agent];
  doc.getElementById('identity').textContent = scenario === 'offline'
    ? '连接中断 · codex · pairfob' : `等待输入 · ${agent} · pairfob`;
  doc.getElementById('detail-context').textContent = `${scenario === 'offline' ? '连接中断' : '等待输入'} · ${agent} · pairfob`;
  const trigger = doc.getElementById('model-info');
  trigger.setAttribute('aria-label', `完成 3 步，用时 1 分 12 秒，本轮模型 ${state.model}，思考强度 ${state.effort}，查看执行详情`);
  trigger.title = `本轮执行记录：${state.id} · thinking effort ${state.effort}`;
  document.getElementById('state-title').textContent = state.title;
  document.getElementById('state-copy').textContent = state.copy;
  document.querySelector('.stage-note').textContent = '点“完成 3 步”卡片，查看执行步骤和本轮模型。演示不连接真实会话。';
}

frame.addEventListener('load', () => {
  const doc = frame.contentDocument;
  const dialog = doc.getElementById('details');
  const trigger = doc.getElementById('model-info');
  let pointer = 'mouse';
  trigger.addEventListener('pointerdown', event => { pointer = event.pointerType; });
  trigger.addEventListener('keydown', () => { pointer = 'keyboard'; });
  trigger.addEventListener('click', () => {
    const touch = pointer === 'touch';
    dialog.classList.toggle('touch', touch);
    dialog.style.top = 'auto';
    dialog.style.bottom = touch ? '0' : 'auto';
    dialog.style.left = touch ? '0' : '12px';
    dialog.showModal();
    if (!touch) {
      const rect = trigger.getBoundingClientRect();
      const box = dialog.getBoundingClientRect();
      const win = frame.contentWindow;
      dialog.style.top = `${Math.max(12, Math.min(rect.bottom + 8, win.innerHeight - box.height - 12))}px`;
      dialog.style.left = `${Math.max(12, Math.min(rect.left, win.innerWidth - box.width - 12))}px`;
    }
  });
  doc.getElementById('close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => trigger.focus({ preventScroll: true }));
  doc.addEventListener('keydown', event => {
    if (!event.isTrusted || event.metaKey || event.ctrlKey) return;
    keyboardSeen = true;
    doc.body.classList.add('has-keyboard');
  });
  render();
  fit();
  document.documentElement.dataset.ready = 'true';
});

frame.srcdoc = document.getElementById('app-template').innerHTML;
document.querySelectorAll('[data-device]').forEach(button => button.addEventListener('click', () => {
  device = button.dataset.device;
  document.querySelectorAll('[data-device]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  document.getElementById('workbench').classList.toggle('wide', device !== 'phone');
  frame.contentDocument?.getElementById('details')?.close();
  fit();
}));
document.getElementById('scenario').addEventListener('change', event => {
  scenario = event.target.value;
  render();
});
new ResizeObserver(fit).observe(document.querySelector('.stage'));
