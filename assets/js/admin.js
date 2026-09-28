/* ==========================================================
   PAINEL TAVONNI
   Login, cadastro de pods (foto no storage "pods"), marcas
   e pedidos que chegam do site.
   ========================================================== */
(function () {
  'use strict';

  const CONF = window.TAVONNI_CONFIG || {};
  const BUCKET = CONF.BUCKET || 'pods';
  const db = window.supabase.createClient(CONF.SUPABASE_URL, CONF.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tavonni-painel' }
  });

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const BRL = (v) => fmt.format(Number(v) || 0);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const ACRESCIMO = 25; // o preço "de" do site é sempre o preço + R$ 25

  const CORES = ['#8b2cf5', '#c04dff', '#ff3fc8', '#ff2d6f', '#ff1744', '#ff7a1a', '#ffc400',
                 '#b6ff3b', '#35d06a', '#00d9ff', '#0fa3ff', '#3d4dff', '#9aa3b5'];
  const MODELOS = [['slim', 'Slim'], ['box', 'Box'], ['tela', 'Com tela'], ['caneta', 'Caneta'], ['frasco', 'Líquido']];

  const S = {
    marcas: [], produtos: [], pedidos: [],
    busca: '', marca: 'todas', statusPedidos: 'pendente', tab: 'pods',
    edit: null,           // produto sendo editado (null = novo)
    foto: null,           // { blob, url, ext, type } escolhida agora
    removerFoto: false,
    cor: CORES[0], modelo: 'slim',
    marcaEdit: null, marcaCor: CORES[0], marcaVolta: false
  };

  // ---------- utilidades ----------
  let toastTimer = 0;
  function toast(msg, erro) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('is-error', !!erro);
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 2600);
  }
  function loading(btn, on) { btn.disabled = on; btn.classList.toggle('is-loading', on); }
  function parsePreco(v) {
    let s = String(v || '').replace(/[^\d.,]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Math.round(parseFloat(s) * 100) / 100;
    return Number.isFinite(n) ? n : NaN;
  }
  const precoTexto = (n) => (Number(n) || 0).toFixed(2).replace('.', ',');
  function slugify(s) {
    return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'marca';
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15);
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
  }
  function msgErro(err) {
    const m = String((err && (err.message || err.error_description)) || err || '');
    if (/fetch|network/i.test(m)) return 'Sem conexão. Tente de novo.';
    if (/JWT|expired|token/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
    return m || 'Algo deu errado.';
  }
  const marcaDe = (p) => S.marcas.find((m) => m.id === p.marca_id);
  const esgotado = (p) => !p.disponivel || p.estoque <= 0;
  const artSrc = (p) => PodArt.src({ id: p.id || 'novo', modelo: p.modelo, cor: p.cor, cor2: p.cor2, sabor: p.sabor, info: p.info, imagem: p.imagem_url || '' }, (marcaDe(p) || {}).nome || '');

  // ---------- login ----------
  function mostrar(qual) {
    $('#boot').hidden = true;
    $('#login').hidden = qual !== 'login';
    $('#app').hidden = qual !== 'app';
  }

  async function ehAdmin(user) {
    const { data, error } = await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return !!data;
  }

  async function entrar(e) {
    e.preventDefault();
    const f = e.target.elements;
    const usuario = f.usuario.value.trim().toLowerCase();
    const senha = f.senha.value;
    const erro = $('#loginError');
    erro.textContent = '';
    if (!usuario || !senha) { erro.textContent = 'Preencha usuário e senha.'; return; }
    const email = usuario.includes('@') ? usuario : `${usuario}@${CONF.LOGIN_DOMINIO}`;
    const btn = $('#loginBtn');
    loading(btn, true);
    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password: senha });
      if (error) throw error;
      if (!(await ehAdmin(data.user))) {
        await db.auth.signOut();
        erro.textContent = 'Este usuário não tem acesso ao painel.';
        return;
      }
      f.senha.value = '';
      await abrirApp();
    } catch (err) {
      erro.textContent = /invalid|credentials/i.test(String(err && err.message)) ? 'Usuário ou senha incorretos.' : msgErro(err);
    } finally {
      loading(btn, false);
    }
  }

  async function sair() {
    await db.auth.signOut();
    S.produtos = []; S.marcas = []; S.pedidos = [];
    mostrar('login');
  }

  // ---------- dados ----------
  async function carregarTudo() {
    const [m, p] = await Promise.all([
      db.from('marcas').select('*').order('ordem').order('nome'),
      db.from('produtos').select('*').order('ordem').order('created_at')
    ]);
    if (m.error) throw m.error;
    if (p.error) throw p.error;
    S.marcas = m.data || [];
    S.produtos = p.data || [];
  }

  async function carregarPedidos() {
    const { data, error } = await db.from('pedidos').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    S.pedidos = data || [];
    atualizarBadge();
  }

  function atualizarBadge() {
    const n = S.pedidos.filter((x) => x.status === 'pendente').length;
    const b = $('#pendentesBadge');
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : n;
  }

  async function abrirApp() {
    mostrar('app');
    if (CONF.SITE_URL) { $('#verSite').href = CONF.SITE_URL; $('#verSite').hidden = false; }
    $('#podsList').innerHTML = '<div class="empty">Carregando…</div>';
    try {
      await Promise.all([carregarTudo(), carregarPedidos()]);
    } catch (err) {
      $('#podsList').innerHTML = `<div class="empty"><strong>Não foi possível carregar</strong>${esc(msgErro(err))}</div>`;
      return;
    }
    renderTudo();
  }

  function renderTudo() {
    renderChips();
    renderPods();
    renderMarcas();
    renderPedidos();
  }

  // ---------- abas ----------
  const TITULOS = { pods: 'Pods', marcas: 'Marcas', pedidos: 'Pedidos' };
  function irPara(tab) {
    S.tab = tab;
    $$('.tab').forEach((t) => { t.hidden = t.dataset.tab !== tab; });
    $$('.tabbar button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.go === tab));
    $$('.tabbar button[aria-current]').forEach((b) => b.setAttribute('aria-current', 'page'));
    $('#topTitle').textContent = TITULOS[tab];
    $('#fab').hidden = tab === 'pedidos';
    $('#fabLabel').textContent = tab === 'marcas' ? 'Nova marca' : 'Novo pod';
    window.scrollTo(0, 0);
    if (tab === 'pedidos') carregarPedidos().then(renderPedidos).catch((err) => toast(msgErro(err), true));
  }

  // ---------- lista de pods ----------
  function renderChips() {
    const cont = {};
    S.produtos.forEach((p) => { cont[p.marca_id] = (cont[p.marca_id] || 0) + 1; });
    if (S.marca !== 'todas' && !S.marcas.some((m) => m.id === S.marca)) S.marca = 'todas';
    $('#marcaChips').innerHTML =
      `<button class="chip" type="button" data-marca="todas" aria-pressed="${S.marca === 'todas'}">Todas <small>${S.produtos.length}</small></button>` +
      S.marcas.map((m) => `<button class="chip" type="button" data-marca="${m.id}" aria-pressed="${S.marca === m.id}" style="--c:${esc(m.cor)}"><i></i>${esc(m.nome)} <small>${cont[m.id] || 0}</small></button>`).join('');
  }

  function statusPill(p) {
    if (!p.disponivel) return '<span class="pill pill--off">Fora de venda</span>';
    if (p.estoque <= 0) return '<span class="pill pill--off">Esgotado</span>';
    if (p.estoque <= 3) return '<span class="pill pill--low">Acabando</span>';
    return '<span class="pill pill--ok">Em estoque</span>';
  }

  function podRow(p) {
    const m = marcaDe(p);
    return `<article class="pod-row${esgotado(p) ? ' is-off' : ''}" data-id="${p.id}" style="--c:${esc(p.cor)}">
      <button class="pod-row__main" type="button" data-editar>
        <div class="thumb"><img src="${esc(artSrc(p))}" alt="" loading="lazy"></div>
        <div class="pod-row__info">
          <strong>${esc(p.nome)}</strong>
          <span class="flavor">${esc(p.sabor)}</span>
          <span class="brand">${esc(m ? m.nome : '—')}${p.destaque ? ' · ★ destaque' : ''}</span>
          <span class="prices"><s>${BRL(Number(p.preco) + ACRESCIMO)}</s><b>${BRL(p.preco)}</b></span>
        </div>
      </button>
      <div class="pod-row__side">
        ${statusPill(p)}
        <div class="mini-qty" role="group" aria-label="Estoque de ${esc(p.nome)} ${esc(p.sabor)}">
          <button type="button" data-qtd="-1" aria-label="Diminuir estoque"${p.estoque <= 0 ? ' disabled' : ''}>−</button>
          <output>${p.estoque}</output>
          <button type="button" data-qtd="1" aria-label="Aumentar estoque">+</button>
        </div>
      </div>
    </article>`;
  }

  function renderPods() {
    const q = norm(S.busca.trim());
    const lista = S.produtos.filter((p) => {
      if (S.marca !== 'todas' && p.marca_id !== S.marca) return false;
      if (q && !norm(`${p.nome} ${p.sabor} ${(marcaDe(p) || {}).nome || ''}`).includes(q)) return false;
      return true;
    });
    const sem = S.produtos.filter(esgotado).length;
    $('#podsResumo').textContent = `${S.produtos.length} ${S.produtos.length === 1 ? 'pod' : 'pods'} cadastrados · ${sem} sem estoque`;
    if (!S.marcas.length) {
      $('#podsList').innerHTML = '<div class="empty"><strong>Comece pelas marcas</strong>Cadastre pelo menos uma marca na aba Marcas.</div>';
      return;
    }
    $('#podsList').innerHTML = lista.length ? lista.map(podRow).join('')
      : `<div class="empty"><strong>${S.produtos.length ? 'Nada encontrado' : 'Nenhum pod ainda'}</strong>${S.produtos.length ? 'Tente outra busca ou marca.' : 'Toque em “Novo pod” para cadastrar o primeiro.'}</div>`;
  }

  // estoque rápido pela lista (salva sozinho)
  const timersEstoque = new Map();
  function mudarEstoqueRapido(id, delta, row) {
    const p = S.produtos.find((x) => x.id === id);
    if (!p) return;
    p.estoque = Math.max(0, p.estoque + delta);
    const novo = document.createElement('div');
    novo.innerHTML = podRow(p);
    row.replaceWith(novo.firstElementChild);
    clearTimeout(timersEstoque.get(id));
    timersEstoque.set(id, setTimeout(async () => {
      const { error } = await db.from('produtos').update({ estoque: p.estoque }).eq('id', id);
      if (error) { toast('Não salvou o estoque: ' + msgErro(error), true); return; }
      toast(`Estoque de ${p.sabor}: ${p.estoque}`);
      $('#podsResumo').textContent = `${S.produtos.length} pods cadastrados · ${S.produtos.filter(esgotado).length} sem estoque`;
    }, 600));
  }

  // ---------- formulário do pod ----------
  function renderSwatches(el, atual, name) {
    const custom = !CORES.includes(atual);
    el.innerHTML = CORES.map((c) => `<button type="button" class="swatch" role="radio" aria-checked="${c === atual}" aria-label="Cor ${c}" data-cor="${c}" style="--c:${c}"></button>`).join('') +
      `<label class="swatch swatch--custom" role="radio" aria-checked="${custom}" aria-label="Outra cor" style="--c:${custom ? atual : '#ffffff'}"><input type="color" value="${custom ? atual : '#8b2cf5'}" data-${name}></label>`;
  }

  // só troca a seleção (não recria, para não fechar o seletor de cor do celular)
  function marcarSwatch(el, cor) {
    $$('button.swatch', el).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cor === cor)));
    const custom = $('.swatch--custom', el);
    const livre = !CORES.includes(cor);
    custom.setAttribute('aria-checked', String(livre));
    if (livre) custom.style.setProperty('--c', cor);
  }

  function abrirPod(p) {
    S.edit = p || null;
    S.foto = null;
    S.removerFoto = false;
    S.cor = p ? p.cor : CORES[0];
    S.modelo = p ? p.modelo : 'slim';
    $('#podSheetTitle').textContent = p ? 'Editar pod' : 'Novo pod';
    $('#btnExcluir').hidden = !p;
    $('#btnSalvar').textContent = p ? 'Salvar alterações' : 'Cadastrar pod';
    $('#podError').textContent = '';
    $$('#podForm .field').forEach((f) => f.classList.remove('is-invalid'));

    preencherMarcas(p ? p.marca_id : (S.marca !== 'todas' ? S.marca : (S.marcas[0] || {}).id));
    $('#fNome').value = p ? p.nome : '';
    $('#fSabor').value = p ? p.sabor : '';
    $('#fInfo').value = p ? (p.info || '') : '';
    $('#fPreco').value = p ? precoTexto(p.preco) : '';
    $('#fEstoque').value = p ? p.estoque : 0;
    $('#fDisponivel').checked = p ? p.disponivel : true;
    $('#fPrevisao').value = p && p.previsao ? p.previsao : '';
    $('#fDestaque').checked = p ? p.destaque : false;
    $('#fFoto').value = '';
    $('#fotoHint').textContent = 'Use PNG sem fundo. A foto é recortada e otimizada sozinha.';
    $('#fotoHint').classList.remove('is-warn');
    renderSwatches($('#swatches'), S.cor, 'cor');
    $('#modelos').innerHTML = MODELOS.map(([v, t]) => `<button type="button" data-modelo="${v}" aria-pressed="${v === S.modelo}">${t}</button>`).join('');
    atualizarPreview();
    $('#podSheet').showModal();
    $('#podSheet .sheet__body').scrollTop = 0;
  }

  function preencherMarcas(sel) {
    $('#fMarca').innerHTML = S.marcas.length
      ? S.marcas.map((m) => `<option value="${m.id}"${m.id === sel ? ' selected' : ''}>${esc(m.nome)}</option>`).join('')
      : '<option value="">Cadastre uma marca</option>';
  }

  function fotoAtualUrl() {
    if (S.foto) return S.foto.url;
    if (S.edit && S.edit.imagem_url && !S.removerFoto) return S.edit.imagem_url;
    return '';
  }

  function atualizarPreview() {
    const cor = S.cor;
    const cor2 = PodArt.light(cor, 0.35);
    const estoque = Math.max(0, parseInt($('#fEstoque').value, 10) || 0);
    const disp = $('#fDisponivel').checked;
    const off = !disp || estoque <= 0;
    const preco = parsePreco($('#fPreco').value);
    const foto = fotoAtualUrl();
    const marca = S.marcas.find((m) => m.id === $('#fMarca').value);

    const stage = $('#pvStage');
    stage.style.setProperty('--c', cor);
    stage.style.setProperty('--c2', cor2);
    stage.classList.toggle('is-off', off);
    $('#pvImg').src = foto || PodArt.src({ id: 'previa', modelo: S.modelo, cor, cor2, sabor: $('#fSabor').value, info: $('#fInfo').value }, marca ? marca.nome : '');
    $('#pvTag').hidden = !off;
    $('#pvTag').textContent = 'Esgotado';
    $('.preview__info').style.setProperty('--c2', cor2);
    $('#pvNome').textContent = $('#fNome').value.trim() || 'Nome do pod';
    $('#pvSabor').textContent = $('#fSabor').value.trim() || 'Sabor';
    $('#pvAntigo').textContent = Number.isFinite(preco) ? BRL(preco + ACRESCIMO) : '';
    $('#pvPreco').textContent = Number.isFinite(preco) ? BRL(preco) : 'R$ 0,00';
    $('#precoHint').textContent = Number.isFinite(preco)
      ? `No site: ${BRL(preco + ACRESCIMO)} riscado e ${BRL(preco)} em destaque.`
      : 'No site aparece o preço + R$ 25 riscado e o seu preço em destaque.';
    $('#previsaoField').hidden = !off;
    $('#modeloField').hidden = !!foto;
    $('#btnRemoverFoto').hidden = !foto;
    $('#fotoLabel').textContent = foto ? 'Trocar foto' : 'Escolher foto';
  }

  // recorta a parte transparente, reduz o tamanho e converte para WebP
  function carregarImagem(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir essa imagem. Tente PNG, JPG ou WebP.')); };
      img.src = url;
    });
  }

  async function prepararImagem(file) {
    const img = await carregarImagem(file);
    const MAX_LEITURA = 1600, MAX_FINAL = 1100;
    let w = img.naturalWidth, h = img.naturalHeight;
    const s1 = Math.min(1, MAX_LEITURA / Math.max(w, h));
    w = Math.max(1, Math.round(w * s1)); h = Math.max(1, Math.round(h * s1));
    const c1 = document.createElement('canvas');
    c1.width = w; c1.height = h;
    const x1 = c1.getContext('2d', { willReadFrequently: true });
    x1.drawImage(img, 0, 0, w, h);
    const px = x1.getImageData(0, 0, w, h).data;

    let minX = w, minY = h, maxX = -1, maxY = -1, transparente = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = px[(y * w + x) * 4 + 3];
        if (a < 250) transparente = true;
        if (a > 12) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) throw new Error('A imagem está vazia (toda transparente).');
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.02);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const s2 = Math.min(1, MAX_FINAL / Math.max(cw, ch));
    const c2 = document.createElement('canvas');
    c2.width = Math.round(cw * s2); c2.height = Math.round(ch * s2);
    const x2 = c2.getContext('2d');
    x2.imageSmoothingQuality = 'high';
    x2.drawImage(c1, minX, minY, cw, ch, 0, 0, c2.width, c2.height);

    const toBlob = (type, q) => new Promise((r) => c2.toBlob(r, type, q));
    let blob = await toBlob('image/webp', 0.9);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/png');
    if (!blob) throw new Error('Não consegui preparar a imagem.');
    const ext = blob.type === 'image/webp' ? 'webp' : 'png';
    return { blob, ext, type: blob.type, url: URL.createObjectURL(blob), transparente };
  }

  async function escolherFoto(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const hint = $('#fotoHint');
    hint.textContent = 'Preparando a foto…';
    hint.classList.remove('is-warn');
    try {
      if (S.foto) URL.revokeObjectURL(S.foto.url);
      S.foto = await prepararImagem(file);
      S.removerFoto = false;
      if (S.foto.transparente) {
        hint.textContent = 'Foto pronta. Ela só sobe quando você salvar.';
      } else {
        hint.textContent = 'Essa foto tem fundo. Para ficar igual ao site, prefira PNG sem fundo.';
        hint.classList.add('is-warn');
      }
    } catch (err) {
      S.foto = null;
      hint.textContent = msgErro(err);
      hint.classList.add('is-warn');
    }
    atualizarPreview();
  }

  function validarPod() {
    const erros = [];
    const marca = $('#fMarca').value;
    const nome = $('#fNome').value.trim();
    const sabor = $('#fSabor').value.trim();
    const preco = parsePreco($('#fPreco').value);
    $$('#podForm .field').forEach((f) => f.classList.remove('is-invalid'));
    if (!marca) erros.push(['#fMarca', 'Escolha a marca.']);
    if (!nome) erros.push(['#fNome', 'Informe o nome do produto.']);
    if (!sabor) erros.push(['#fSabor', 'Informe o sabor.']);
    if (!Number.isFinite(preco) || preco <= 0) erros.push(['#fPreco', 'Informe o preço de venda.']);
    erros.forEach(([sel]) => $(sel).closest('.field').classList.add('is-invalid'));
    if (erros.length) {
      $('#podError').textContent = erros[0][1];
      $(erros[0][0]).focus();
      return null;
    }
    const estoque = Math.max(0, Math.min(9999, parseInt($('#fEstoque').value, 10) || 0));
    const disponivel = $('#fDisponivel').checked;
    const off = !disponivel || estoque <= 0;
    return {
      marca_id: marca, nome, sabor,
      info: $('#fInfo').value.trim() || null,
      preco, estoque, disponivel,
      previsao: off && $('#fPrevisao').value ? $('#fPrevisao').value : null,
      cor: S.cor, cor2: PodArt.light(S.cor, 0.35),
      modelo: S.modelo,
      destaque: $('#fDestaque').checked
    };
  }

  async function salvarPod(e) {
    e.preventDefault();
    const dados = validarPod();
    if (!dados) return;
    const btn = $('#btnSalvar');
    loading(btn, true);
    $('#podError').textContent = '';

    const novo = !S.edit;
    const id = novo ? uuid() : S.edit.id;
    const antigoPath = S.edit ? S.edit.imagem_path : null;
    let enviado = null;

    try {
      if (S.foto) {
        const path = `produtos/${id}-${Date.now()}.${S.foto.ext}`;
        const up = await db.storage.from(BUCKET).upload(path, S.foto.blob, { contentType: S.foto.type, cacheControl: '31536000', upsert: false });
        if (up.error) throw up.error;
        enviado = path;
        dados.imagem_path = path;
        dados.imagem_url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      } else if (S.removerFoto) {
        dados.imagem_path = null;
        dados.imagem_url = null;
      }

      let res;
      if (novo) {
        const ordem = S.produtos.reduce((mx, p) => Math.max(mx, p.ordem || 0), 0) + 1;
        res = await db.from('produtos').insert({ id, ordem, ...dados }).select().single();
      } else {
        res = await db.from('produtos').update(dados).eq('id', id).select().single();
      }
      if (res.error) throw res.error;

      // apaga a foto antiga se ela foi trocada ou removida
      if (antigoPath && (enviado || S.removerFoto) && antigoPath !== enviado) {
        db.storage.from(BUCKET).remove([antigoPath]).then(() => {}, () => {});
      }

      const i = S.produtos.findIndex((p) => p.id === id);
      if (i >= 0) S.produtos[i] = res.data; else S.produtos.push(res.data);
      $('#podSheet').close();
      renderChips();
      renderPods();
      toast(novo ? 'Pod cadastrado! Já está no site.' : 'Alterações salvas no site.');
    } catch (err) {
      if (enviado) db.storage.from(BUCKET).remove([enviado]).then(() => {}, () => {});
      $('#podError').textContent = 'Não foi possível salvar: ' + msgErro(err);
    } finally {
      loading(btn, false);
    }
  }

  async function excluirPod() {
    const p = S.edit;
    if (!p) return;
    if (!confirm(`Excluir ${p.nome} ${p.sabor}? Ele sai do site na hora.`)) return;
    const btn = $('#btnExcluir');
    loading(btn, true);
    const { error } = await db.from('produtos').delete().eq('id', p.id);
    loading(btn, false);
    if (error) { $('#podError').textContent = 'Não foi possível excluir: ' + msgErro(error); return; }
    if (p.imagem_path) db.storage.from(BUCKET).remove([p.imagem_path]).then(() => {}, () => {});
    S.produtos = S.produtos.filter((x) => x.id !== p.id);
    $('#podSheet').close();
    renderChips();
    renderPods();
    toast('Pod excluído.');
  }

  // ---------- marcas ----------
  function renderMarcas() {
    const cont = {};
    S.produtos.forEach((p) => { cont[p.marca_id] = (cont[p.marca_id] || 0) + 1; });
    $('#marcasList').innerHTML = S.marcas.length
      ? S.marcas.map((m) => `<button class="brand-row" type="button" data-marca-id="${m.id}" style="--c:${esc(m.cor)}">
          <i></i><strong>${esc(m.nome)}</strong><small>${cont[m.id] || 0} ${(cont[m.id] || 0) === 1 ? 'pod' : 'pods'}</small>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        </button>`).join('')
      : '<div class="empty"><strong>Nenhuma marca</strong>Toque em “Nova marca” para começar.</div>';
  }

  function abrirMarca(m, voltarParaPod) {
    S.marcaEdit = m || null;
    S.marcaVolta = !!voltarParaPod;
    S.marcaCor = m ? m.cor : CORES[(S.marcas.length * 3) % CORES.length];
    $('#marcaSheetTitle').textContent = m ? 'Editar marca' : 'Nova marca';
    $('#mNome').value = m ? m.nome : '';
    $('#marcaError').textContent = '';
    $('#btnExcluirMarca').hidden = !m;
    renderSwatches($('#mSwatches'), S.marcaCor, 'mcor');
    $('#marcaSheet').showModal();
    setTimeout(() => $('#mNome').focus(), 80);
  }

  async function salvarMarca(e) {
    e.preventDefault();
    const nome = $('#mNome').value.trim();
    if (!nome) { $('#marcaError').textContent = 'Informe o nome da marca.'; $('#mNome').focus(); return; }
    const btn = $('#marcaForm button[type="submit"]');
    loading(btn, true);
    try {
      let res;
      if (S.marcaEdit) {
        res = await db.from('marcas').update({ nome, cor: S.marcaCor }).eq('id', S.marcaEdit.id).select().single();
      } else {
        let slug = slugify(nome), n = 2;
        while (S.marcas.some((m) => m.slug === slug)) slug = `${slugify(nome)}-${n++}`;
        const ordem = S.marcas.reduce((mx, m) => Math.max(mx, m.ordem || 0), 0) + 1;
        res = await db.from('marcas').insert({ nome, slug, cor: S.marcaCor, ordem }).select().single();
      }
      if (res.error) throw res.error;
      const i = S.marcas.findIndex((m) => m.id === res.data.id);
      if (i >= 0) S.marcas[i] = res.data; else S.marcas.push(res.data);
      $('#marcaSheet').close();
      renderChips(); renderMarcas(); renderPods();
      if (S.marcaVolta) { preencherMarcas(res.data.id); atualizarPreview(); }
      else toast('Marca salva.');
    } catch (err) {
      $('#marcaError').textContent = /duplicate|unique/i.test(msgErro(err)) ? 'Já existe uma marca com esse nome.' : 'Não foi possível salvar: ' + msgErro(err);
    } finally {
      loading(btn, false);
    }
  }

  async function excluirMarca() {
    const m = S.marcaEdit;
    if (!m) return;
    const qtd = S.produtos.filter((p) => p.marca_id === m.id).length;
    if (qtd) { $('#marcaError').textContent = `Essa marca tem ${qtd} ${qtd === 1 ? 'pod' : 'pods'}. Exclua ou troque a marca deles antes.`; return; }
    if (!confirm(`Excluir a marca ${m.nome}?`)) return;
    const { error } = await db.from('marcas').delete().eq('id', m.id);
    if (error) { $('#marcaError').textContent = 'Não foi possível excluir: ' + msgErro(error); return; }
    S.marcas = S.marcas.filter((x) => x.id !== m.id);
    $('#marcaSheet').close();
    renderChips(); renderMarcas(); renderPods();
    toast('Marca excluída.');
  }

  // ---------- pedidos ----------
  const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const dataCurta = (iso) => { const [y, m, d] = String(iso || '').split('-'); return d ? `${d}/${m}/${y}` : ''; };

  function renderPedidos() {
    const lista = S.pedidos.filter((x) => x.status === S.statusPedidos);
    const vazio = { pendente: 'Nenhum pedido esperando confirmação.', confirmado: 'Nenhuma venda confirmada ainda.', cancelado: 'Nenhum pedido cancelado.' };
    $('#pedidosList').innerHTML = lista.length ? lista.map((o) => {
      const itens = (o.itens || []).map((i) => `<div><span>${i.qtd}× ${esc(i.nome)} · ${esc(i.sabor)}${i.agendado ? `<em>agendado${i.data ? ' para ' + dataCurta(i.data) : ''}</em>` : ''}</span><b>${BRL(i.subtotal)}</b></div>`).join('');
      const onde = o.tipo === 'entrega' ? `Entrega · ${esc([o.endereco, o.bairro].filter(Boolean).join(' – '))}${o.complemento ? ` (${esc(o.complemento)})` : ''}` : 'Retirada';
      let acoes = '';
      if (o.status === 'pendente') acoes = `<button class="btn btn--ghost" type="button" data-status="cancelado">Cancelar</button><button class="btn btn--solid" type="button" data-status="confirmado">Confirmar venda</button>`;
      else if (o.status === 'confirmado') acoes = `<button class="btn btn--ghost" type="button" data-status="pendente">Desfazer confirmação</button>`;
      else acoes = `<button class="btn btn--ghost" type="button" data-status="pendente">Voltar para pendente</button>`;
      return `<article class="order" data-pedido="${o.id}">
        <div class="order__head"><strong>Pedido #${o.codigo}</strong><time>${dataHora(o.created_at)}</time></div>
        <p class="order__client">${esc(o.cliente_nome)}</p>
        <p class="order__meta">${onde}${o.pagamento ? ` · ${esc(o.pagamento)}` : ''}</p>
        ${o.observacao ? `<p class="order__meta">Obs.: ${esc(o.observacao)}</p>` : ''}
        <div class="order__items">${itens}</div>
        <div class="order__total"><span>Total</span><span>${BRL(o.total)}</span></div>
        <div class="order__actions">${acoes}</div>
      </article>`;
    }).join('') : `<div class="empty">${vazio[S.statusPedidos]}</div>`;
  }

  async function mudarStatus(id, status, btn) {
    const textos = {
      confirmado: 'Confirmar esta venda? O estoque dos itens de pronta entrega vai diminuir.',
      cancelado: 'Cancelar este pedido?',
      pendente: 'Voltar este pedido para pendente? Se estava confirmado, o estoque volta.'
    };
    if (!confirm(textos[status])) return;
    loading(btn, true);
    const { error } = await db.rpc('atualizar_status_pedido', { p_id: id, p_status: status });
    if (error) { loading(btn, false); toast('Não foi possível: ' + msgErro(error), true); return; }
    try {
      await Promise.all([carregarPedidos(), carregarTudo()]);
    } catch (err) { /* a lista atualiza na próxima vez */ }
    renderPedidos(); renderPods(); renderChips();
    toast(status === 'confirmado' ? 'Venda confirmada. Estoque atualizado.' : status === 'cancelado' ? 'Pedido cancelado.' : 'Pedido voltou para pendente.');
  }

  // ---------- eventos ----------
  function ligar() {
    $('#loginForm').addEventListener('submit', entrar);
    $('#togglePass').addEventListener('click', () => {
      const i = $('#loginForm').elements.senha;
      i.type = i.type === 'password' ? 'text' : 'password';
    });
    $('#sair').addEventListener('click', () => { if (confirm('Sair do painel?')) sair(); });

    $$('.tabbar button').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.go)));
    $('#fab').addEventListener('click', () => {
      if (S.tab === 'marcas') return abrirMarca(null);
      if (!S.marcas.length) { toast('Cadastre uma marca primeiro.'); irPara('marcas'); return; }
      abrirPod(null);
    });

    let t = 0;
    $('#busca').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.busca = e.target.value; renderPods(); }, 120); });
    $('#marcaChips').addEventListener('click', (e) => {
      const c = e.target.closest('[data-marca]');
      if (!c) return;
      S.marca = c.dataset.marca;
      renderChips(); renderPods();
    });
    $('#podsList').addEventListener('click', (e) => {
      const row = e.target.closest('.pod-row');
      if (!row) return;
      const q = e.target.closest('[data-qtd]');
      if (q) { mudarEstoqueRapido(row.dataset.id, Number(q.dataset.qtd), row); return; }
      if (e.target.closest('[data-editar]')) abrirPod(S.produtos.find((p) => p.id === row.dataset.id));
    });

    // formulário do pod
    const form = $('#podForm');
    form.addEventListener('submit', salvarPod);
    form.addEventListener('input', (e) => {
      if (e.target.closest('.field')) e.target.closest('.field').classList.remove('is-invalid');
      $('#podError').textContent = '';
      if (e.target.matches('input[data-cor]')) {
        S.cor = e.target.value;
        marcarSwatch($('#swatches'), S.cor);
      }
      atualizarPreview();
    });
    form.addEventListener('change', atualizarPreview);
    $('#swatches').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cor]');
      if (!b || b.tagName === 'INPUT') return;
      S.cor = b.dataset.cor;
      marcarSwatch($('#swatches'), S.cor);
      atualizarPreview();
    });
    $('#modelos').addEventListener('click', (e) => {
      const b = e.target.closest('[data-modelo]');
      if (!b) return;
      S.modelo = b.dataset.modelo;
      $$('#modelos button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      atualizarPreview();
    });
    $('#fFoto').addEventListener('change', escolherFoto);
    $('#btnRemoverFoto').addEventListener('click', () => {
      if (S.foto) { URL.revokeObjectURL(S.foto.url); S.foto = null; }
      if (S.edit && S.edit.imagem_url) S.removerFoto = true;
      $('#fFoto').value = '';
      $('#fotoHint').textContent = 'Sem foto: o site mostra um desenho do pod na cor escolhida.';
      $('#fotoHint').classList.remove('is-warn');
      atualizarPreview();
    });
    const est = $('#fEstoque');
    $('#estMenos').addEventListener('click', () => { est.value = Math.max(0, (parseInt(est.value, 10) || 0) - 1); atualizarPreview(); });
    $('#estMais').addEventListener('click', () => { est.value = Math.min(9999, (parseInt(est.value, 10) || 0) + 1); atualizarPreview(); });
    $('#fPreco').addEventListener('blur', (e) => { const n = parsePreco(e.target.value); if (Number.isFinite(n) && n > 0) e.target.value = precoTexto(n); });
    $('#btnNovaMarca').addEventListener('click', () => abrirMarca(null, true));
    $('#btnExcluir').addEventListener('click', excluirPod);

    // marcas
    $('#marcasList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-marca-id]');
      if (b) abrirMarca(S.marcas.find((m) => m.id === b.dataset.marcaId));
    });
    $('#marcaForm').addEventListener('submit', salvarMarca);
    $('#mSwatches').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cor]');
      if (!b || b.tagName === 'INPUT') return;
      S.marcaCor = b.dataset.cor;
      marcarSwatch($('#mSwatches'), S.marcaCor);
    });
    $('#mSwatches').addEventListener('input', (e) => {
      if (!e.target.matches('[data-mcor]')) return;
      S.marcaCor = e.target.value;
      marcarSwatch($('#mSwatches'), S.marcaCor);
    });
    $('#btnExcluirMarca').addEventListener('click', excluirMarca);

    // pedidos
    $('#pedidosSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      S.statusPedidos = b.dataset.status;
      $$('#pedidosSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderPedidos();
    });
    $('#pedidosList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status]');
      const card = e.target.closest('[data-pedido]');
      if (b && card) mudarStatus(card.dataset.pedido, b.dataset.status, b);
    });

    // fechar folhas
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    $('#podSheet').addEventListener('close', () => { if (S.foto) { URL.revokeObjectURL(S.foto.url); S.foto = null; } });

    db.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') mostrar('login');
    });
  }

  // ---------- início ----------
  async function iniciar() {
    ligar();
    try {
      const { data } = await db.auth.getSession();
      if (data.session && await ehAdmin(data.session.user)) { await abrirApp(); return; }
      if (data.session) await db.auth.signOut();
    } catch (err) { /* cai no login */ }
    mostrar('login');
  }

  iniciar();
})();
