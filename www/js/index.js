(function () {
  'use strict';

  const STORAGE_KEY = 'sm1.settings.v1';
  const REQUEST_TIMEOUT_MS = 8000;
  const SPLASH_MIN_MS = 1700;
  const OPEN_DELAY_MS = 220;
  const PUSH_TOPIC = 'sm1_all';

  let settings = { redirectRest: '', pushRest: '' };
  let startUrl = '';
  let browserRef = null;
  let reopenTimer = null;
  let splashStartedAt = Date.now();
  let starting = false;

  const splashScreen = document.getElementById('splashScreen');
  const configScreen = document.getElementById('configScreen');
  const loadingScreen = document.getElementById('loadingScreen');
  const settingsForm = document.getElementById('settingsForm');
  const redirectRestEl = document.getElementById('redirectRest');
  const pushRestEl = document.getElementById('pushRest');
  const saveSettingsBtn = document.getElementById('saveSettings');
  const configMessageEl = document.getElementById('configMessage');
  const loadingTitleEl = document.getElementById('loadingTitle');
  const loadingStatusEl = document.getElementById('loadingStatus');
  const pushStatusEl = document.getElementById('pushStatus');
  const errorActionsEl = document.getElementById('errorActions');
  const retryButton = document.getElementById('retryButton');
  const editSettingsButton = document.getElementById('editSettingsButton');

  function setActiveScreen(screen) {
    [splashScreen, configScreen, loadingScreen].forEach(function (item) {
      item.classList.toggle('active', item === screen);
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function respectSplashMinimum() {
    const elapsed = Date.now() - splashStartedAt;
    if (elapsed < SPLASH_MIN_MS) await wait(SPLASH_MIN_MS - elapsed);
  }

  function setLoading(message, pushMessage) {
    loadingStatusEl.textContent = message || '';
    if (typeof pushMessage === 'string') pushStatusEl.textContent = pushMessage;
  }

  function showConfigMessage(message, type) {
    configMessageEl.textContent = message || '';
    configMessageEl.className = 'message-box';
    if (message) configMessageEl.classList.add('visible', type || 'info');
  }

  function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      redirectRest: String(source.redirectRest || '').trim(),
      pushRest: String(source.pushRest || '').trim()
    };
  }

  function validateSettings(value) {
    if (!isHttpUrl(value.redirectRest)) {
      throw new Error('Informe uma REST de redirecionamento válida, iniciando com http:// ou https://.');
    }
    if (!isHttpUrl(value.pushRest)) {
      throw new Error('Informe uma REST de notificações válida, iniciando com http:// ou https://.');
    }
  }

  function nativeStorageAvailable() {
    return typeof window.NativeStorage !== 'undefined' && window.NativeStorage;
  }

  function storageGet() {
    return new Promise(function (resolve) {
      if (nativeStorageAvailable()) {
        NativeStorage.getItem(
          STORAGE_KEY,
          function (value) { resolve(normalizeSettings(value)); },
          function () { resolve(null); }
        );
        return;
      }

      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        resolve(raw ? normalizeSettings(JSON.parse(raw)) : null);
      } catch (_) {
        resolve(null);
      }
    });
  }

  function storageSet(value) {
    const normalized = normalizeSettings(value);
    return new Promise(function (resolve, reject) {
      if (nativeStorageAvailable()) {
        NativeStorage.setItem(
          STORAGE_KEY,
          normalized,
          resolve,
          function (error) { reject(new Error('Não foi possível gravar as configurações: ' + String(error || 'erro desconhecido'))); }
        );
        return;
      }

      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    const requestOptions = Object.assign({ cache: 'no-store' }, options || {}, { signal: controller.signal });

    try {
      return await fetch(url, requestOptions);
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Tempo limite excedido ao acessar ' + url);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function resolveRedirectUrl(endpoint) {
    const response = await fetchWithTimeout(endpoint, {
      method: 'GET',
      headers: { 'Accept': 'application/json, text/plain;q=0.9' }
    });

    if (!response.ok) throw new Error('REST de redirecionamento retornou HTTP ' + response.status + '.');

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    let value = '';

    if (contentType.indexOf('application/json') >= 0) {
      const data = await response.json();
      value = String(data.url || data.startUrl || data.redirectUrl || '').trim();
    } else {
      value = String(await response.text()).trim();
      if (value.charAt(0) === '{') {
        try {
          const data = JSON.parse(value);
          value = String(data.url || data.startUrl || data.redirectUrl || '').trim();
        } catch (_) {}
      }
    }

    if (!isHttpUrl(value)) throw new Error('A REST de redirecionamento não retornou uma URL http/https válida.');
    return value;
  }

  function grantPushPermission() {
    return new Promise(function (resolve) {
      if (!window.FirebasexMessaging || !FirebasexMessaging.grantPermission) {
        resolve(false);
        return;
      }

      FirebasexMessaging.grantPermission(
        function (allowed) { resolve(Boolean(allowed)); },
        function () { resolve(false); }
      );
    });
  }

  function getFcmToken() {
    return new Promise(function (resolve) {
      if (!window.FirebasexMessaging || !FirebasexMessaging.getToken) {
        resolve('');
        return;
      }

      FirebasexMessaging.getToken(
        function (token) { resolve(String(token || '').trim()); },
        function () { resolve(''); }
      );
    });
  }

  function subscribeToTopic(topicName) {
    const topic = String(topicName || '').trim();
    return new Promise(function (resolve, reject) {
      if (!topic) {
        resolve();
        return;
      }
      if (!window.FirebasexMessaging || !FirebasexMessaging.subscribe) {
        reject(new Error('O plugin de notificações não disponibilizou assinatura de tópico.'));
        return;
      }

      FirebasexMessaging.subscribe(
        topic,
        resolve,
        function (error) { reject(new Error(String(error || 'Falha ao assinar tópico FCM.'))); }
      );
    });
  }

  async function registerTokenAtPushRest(endpoint, token) {
    const payload = {
      app: 'SM1',
      token: token,
      topic: PUSH_TOPIC,
      platform: (window.device && device.platform) ? String(device.platform).toLowerCase() : 'android',
      packageId: 'com.softmobile.sm1'
    };

    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain;q=0.9',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error('REST de notificacoes retornou HTTP ' + response.status + '.');
    return true;
  }

  function registerTokenRefresh() {
    if (!window.FirebasexMessaging || !FirebasexMessaging.onTokenRefresh) return;

    FirebasexMessaging.onTokenRefresh(
      function (token) {
        const refreshedToken = String(token || '').trim();
        if (!refreshedToken) return;

        subscribeToTopic(PUSH_TOPIC)
          .catch(function (error) { console.error('SM1 topic refresh:', error); });

        if (settings.pushRest) {
          registerTokenAtPushRest(settings.pushRest, refreshedToken)
            .catch(function (error) { console.error('SM1 token REST refresh:', error); });
        }
      },
      function (error) { console.error('SM1 onTokenRefresh:', error); }
    );
  }

  function registerMessageHandler() {
    if (!window.FirebasexMessaging || !FirebasexMessaging.onMessageReceived) return;

    FirebasexMessaging.onMessageReceived(
      function (message) {
        console.log('SM1 push recebido:', message);
        const pushUrl = (message && message.url) || (message && message.data && message.data.url) || '';
        if (pushUrl && message && message.tap) {
          try { openExternalUrl(pushUrl); } catch (error) { console.error(error); }
        }
      },
      function (error) { console.error('SM1 onMessageReceived:', error); }
    );
  }

  async function configurePush(endpoint) {
    if (!window.FirebasexMessaging) {
      throw new Error('Plugin Firebase Messaging indisponivel.');
    }

    setLoading('Preparando notificacoes...', 'Push: solicitando permissao');
    const allowed = await grantPushPermission();
    if (!allowed) throw new Error('Permissao de notificacoes nao concedida.');

    setLoading('Preparando notificacoes...', 'Push: obtendo token FCM automaticamente');
    let token = await getFcmToken();

    // Na primeira instalacao, o SDK pode precisar de alguns instantes para gerar o token.
    for (let attempt = 0; !token && attempt < 5; attempt += 1) {
      await wait(700);
      token = await getFcmToken();
    }

    if (!token) throw new Error('O Firebase ainda nao forneceu o token FCM desta instalacao.');

    setLoading('Preparando notificacoes...', 'Push: entrando no topico ' + PUSH_TOPIC);
    await subscribeToTopic(PUSH_TOPIC);

    // A REST recebe o token individual para registro/auditoria, mas nao fornece o token.
    // A falha desta REST nao remove a inscricao do aparelho no topico coletivo.
    try {
      setLoading('Preparando notificacoes...', 'Push: registrando token na REST');
      await registerTokenAtPushRest(endpoint, token);
      setLoading('Notificacoes configuradas.', 'Push: ativo - topico ' + PUSH_TOPIC);
    } catch (registrationError) {
      console.error('SM1 push REST:', registrationError);
      setLoading('Notificacoes configuradas.', 'Push: ativo - topico ' + PUSH_TOPIC + ' - REST indisponivel');
    }

    registerTokenRefresh();
    return token;
  }

  function scheduleDestinationReopen() {
    if (reopenTimer) clearTimeout(reopenTimer);

    reopenTimer = setTimeout(function () {
      reopenTimer = null;
      if (!browserRef && isHttpUrl(startUrl)) openExternalUrl(startUrl);
    }, 180);
  }

  function bindBrowserNavigation(browser, openedUrl) {
    if (!browser || typeof browser.addEventListener !== 'function') return;

    browser.addEventListener('exit', function () {
      if (browserRef === browser) browserRef = null;

      // A troca programatica de janela nao representa o botao Voltar.
      if (browser.__sm1ClosingForReplacement) return;

      // Com hardwareback=no, o Android fecha o InAppBrowser em vez de
      // percorrer seu historico. Reabrimos sempre a URL-base fornecida
      // pela REST, evitando voltar para a tela interna do SM1.
      scheduleDestinationReopen();
    });

    browser.addEventListener('loaderror', function (event) {
      console.error('SM1 InAppBrowser loaderror:', openedUrl, event);
    });
  }

  function openExternalUrl(overrideUrl) {
    const url = String(overrideUrl || startUrl || '').trim();
    if (!isHttpUrl(url)) throw new Error('URL da aplicação inválida.');

    const features = [
      'location=no',
      'toolbar=no',
      'zoom=no',
      'hardwareback=no',
      'hideurlbar=yes',
      'hidenavigationbuttons=yes',
      'clearcache=no',
      'clearsessioncache=no'
    ].join(',');

    if (browserRef && typeof browserRef.close === 'function') {
      try {
        browserRef.__sm1ClosingForReplacement = true;
        browserRef.close();
      } catch (_) {}
    }

    if (window.cordova && cordova.InAppBrowser && cordova.InAppBrowser.open) {
      browserRef = cordova.InAppBrowser.open(url, '_blank', features);
    } else {
      browserRef = window.open(url, '_blank', features);
    }

    bindBrowserNavigation(browserRef, url);
  }

  async function runConfiguredApp() {
    if (starting) return;
    starting = true;
    errorActionsEl.classList.add('hidden');
    loadingTitleEl.textContent = 'Preparando aplicação';
    setActiveScreen(loadingScreen);

    try {
      setLoading('Consultando destino...', 'Push: aguardando');
      startUrl = await resolveRedirectUrl(settings.redirectRest);

      // Configura o FCM antes do redirecionamento. Uma falha no Push não bloqueia o uso do sistema;
      // o processo será tentado novamente na próxima abertura e em futuras renovações do token.
      try {
        await configurePush(settings.pushRest);
      } catch (pushError) {
        console.error('SM1 push:', pushError);
        setLoading('Destino carregado.', 'Push: ' + (pushError.message || String(pushError)));
      }

      setLoading('Abrindo aplicação...', pushStatusEl.textContent);
      await wait(OPEN_DELAY_MS);
      openExternalUrl();
    } catch (error) {
      console.error('SM1 start:', error);
      loadingTitleEl.textContent = 'Não foi possível iniciar';
      setLoading(error.message || String(error), pushStatusEl.textContent);
      errorActionsEl.classList.remove('hidden');
    } finally {
      starting = false;
    }
  }

  function showConfiguration(prefill) {
    if (prefill) {
      redirectRestEl.value = settings.redirectRest || '';
      pushRestEl.value = settings.pushRest || '';
    } else {
      redirectRestEl.value = '';
      pushRestEl.value = '';
    }
    showConfigMessage('', 'info');
    setActiveScreen(configScreen);
    setTimeout(function () { redirectRestEl.focus(); }, 250);
  }

  async function saveAndStart(event) {
    event.preventDefault();
    showConfigMessage('', 'info');
    saveSettingsBtn.disabled = true;

    try {
      const value = normalizeSettings({
        redirectRest: redirectRestEl.value,
        pushRest: pushRestEl.value
      });
      validateSettings(value);

      showConfigMessage('Salvando configurações neste aparelho...', 'info');
      await storageSet(value);
      settings = value;
      showConfigMessage('', 'info');
      await runConfiguredApp();
    } catch (error) {
      showConfigMessage(error.message || String(error), 'error');
    } finally {
      saveSettingsBtn.disabled = false;
    }
  }

  async function start() {
    splashStartedAt = Date.now();
    setActiveScreen(splashScreen);
    registerMessageHandler();

    const saved = await storageGet();
    await respectSplashMinimum();

    if (!saved || !saved.redirectRest || !saved.pushRest) {
      settings = { redirectRest: '', pushRest: '' };
      showConfiguration(false);
      return;
    }

    settings = saved;
    redirectRestEl.value = settings.redirectRest;
    pushRestEl.value = settings.pushRest;

    // Configuração já existe: não exibe a tela de configuração.
    await runConfiguredApp();
  }

  settingsForm.addEventListener('submit', saveAndStart);
  retryButton.addEventListener('click', runConfiguredApp);
  editSettingsButton.addEventListener('click', function () { showConfiguration(true); });

  document.addEventListener('backbutton', function (event) {
    if (!isHttpUrl(startUrl)) return;
    event.preventDefault();
    if (!browserRef) openExternalUrl(startUrl);
  }, false);

  document.addEventListener('deviceready', start, false);
}());
