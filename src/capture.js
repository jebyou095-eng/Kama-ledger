// Screen / window sharing: the picker, starting and stopping the shared stream, the controls that show its state.
// Moved out of main.js. The stream itself stays in main.js (many parts read it); it is reached through getEnv().
export function createCapture(getEnv) {
  var $ = function (id) { return document.getElementById(id); };
  var flowProfile = getEnv().flowProfile;
  var captureSources = [], captureSourceType = 'screen', captureSelection = null, capturePickerResolve = null, pendingCaptureSource = null, activeCaptureSource = null;
  function renderCaptureSources() {
    var list = $('capture-sources');
    var sources = captureSources.filter(function (source) { return source.type === captureSourceType; });
    list.replaceChildren();
    $('capture-empty').hidden = sources.length > 0;
    $('capture-share').disabled = !sources.some(function (source) { return source.id === captureSelection; });
    sources.forEach(function (source) {
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'source-option' + (source.id === captureSelection ? ' selected' : '');
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(source.id === captureSelection));
      var thumbnail = document.createElement('img');
      thumbnail.src = source.thumbnail;
      thumbnail.alt = '';
      var name = document.createElement('span');
      name.textContent = source.name;
      option.append(thumbnail, name);
      option.addEventListener('click', function () {
        captureSelection = source.id;
        renderCaptureSources();
      });
      list.appendChild(option);
    });
  }
  function chooseCaptureSource(sources) {
    captureSources = Array.isArray(sources) ? sources : [];
    var preferred = flowProfile.preferredCapture;
    var matchingPreferred = preferred && captureSources.find(function (source) { return source.type === preferred.type && source.name === preferred.name; });
    captureSourceType = preferred ? preferred.type : 'screen';
    captureSelection = matchingPreferred ? matchingPreferred.id : null;
    $('capture-picker').hidden = false;
    $('picker-screens').classList.toggle('on', captureSourceType === 'screen');
    $('picker-screens').setAttribute('aria-selected', String(captureSourceType === 'screen'));
    $('picker-windows').classList.toggle('on', captureSourceType === 'window');
    $('picker-windows').setAttribute('aria-selected', String(captureSourceType === 'window'));
    renderCaptureSources();
    return new Promise(function (resolve) { capturePickerResolve = resolve; });
  }
  function closeCapturePicker(sourceId) {
    $('capture-picker').hidden = true;
    if (capturePickerResolve) {
      capturePickerResolve(sourceId || null);
      capturePickerResolve = null;
    }
  }
  function setCaptureSourceType(type) {
    captureSourceType = type;
    captureSelection = null;
    var screenTab = type === 'screen';
    $('picker-screens').classList.toggle('on', screenTab);
    $('picker-screens').setAttribute('aria-selected', String(screenTab));
    $('picker-windows').classList.toggle('on', !screenTab);
    $('picker-windows').setAttribute('aria-selected', String(!screenTab));
    renderCaptureSources();
  }
  $('picker-screens').addEventListener('click', function () { setCaptureSourceType('screen'); });
  $('picker-windows').addEventListener('click', function () { setCaptureSourceType('window'); });
  $('capture-share').addEventListener('click', function () {
    pendingCaptureSource = captureSources.find(function (source) { return source.id === captureSelection; }) || null;
    closeCapturePicker(captureSelection);
  });
  $('capture-cancel').addEventListener('click', function () { closeCapturePicker(); });
  $('capture-picker-close').addEventListener('click', function () { closeCapturePicker(); });
  $('capture-picker').addEventListener('click', function (event) {
    if (event.target === this) closeCapturePicker();
  });
  function showCaptureStream(s) {
    getEnv().stream = s;
    setTimeout(function () { getEnv().sessEvent({ type: 'share' }); }, 600);
    activeCaptureSource = pendingCaptureSource;
    if (window.kamaDesktopCapture) window.kamaDesktopCapture.setSharing(true);
    $('vid').srcObject = s;
    $('vid').play();
    $('vw').style.display = 'block';
    $('stop-share').hidden = false;
    var sourceName = pendingCaptureSource ? pendingCaptureSource.name : 'shared screen or window';
    $('capture-status').textContent = 'Sharing ' + sourceName + '.';
    if (pendingCaptureSource) {
      flowProfile.preferredCapture = { type: pendingCaptureSource.type, name: pendingCaptureSource.name };
      pendingCaptureSource = null;
      getEnv().saveFlowProfile();
    }
    getEnv().recordAction('share');
    updateCaptureControls();
    var videoTrack = s.getVideoTracks()[0];
    if (videoTrack) videoTrack.onended = function () { endCapture(false); };
  }
  function updateCaptureControls() {
    $('global-share-toggle').textContent = getEnv().stream ? 'Stop screen share' : 'Start screen share';
    $('global-auto-toggle').textContent = 'Auto capture ' + (getEnv().auto ? 'on' : 'off');
    $('global-auto-toggle').disabled = !getEnv().stream;
    $('live-dot').hidden = !($('live-scan').checked && getEnv().stream);
  }
  function endCapture(stopTracks) {
    var activeStream = getEnv().stream;
    getEnv().stream = null;
    if (window.kamaDesktopCapture) window.kamaDesktopCapture.setSharing(false);
    activeCaptureSource = null;
    getEnv().auto = false;
    getEnv().lastSmall = null;
    if (stopTracks && activeStream) activeStream.getTracks().forEach(function (track) { track.stop(); });
    $('vid').srcObject = null;
    $('vw').style.display = 'none';
    $('stop-share').hidden = true;
    $('autobtn').textContent = 'Auto capture: off';
    $('capture-status').textContent = 'Screen sharing stopped.';
    updateCaptureControls();
  }
  function stopShare() {
    if (!getEnv().stream) return;
    getEnv().recordAction('stop-share');
    endCapture(true);
  }
  function toggleShare() {
    if (getEnv().stream) {
      stopShare();
      return;
    }
    getEnv().show('cap');
    shareScreen();
  }
  function shareScreen() {
    var bridge = window.kamaDesktopCapture;
    if (!bridge) {
      navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        .then(showCaptureStream)
        .catch(function (e) { window.alert('Could not share the window: ' + e.message); });
      return;
    }

    bridge.listSources()
      .then(chooseCaptureSource)
      .then(function (sourceId) {
        if (!sourceId) return null;
        return bridge.selectSource(sourceId, pendingCaptureSource && pendingCaptureSource.name).then(function (selected) {
          if (!selected) throw new Error('The selected screen or window is no longer available.');
          return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        });
      })
      .then(function (s) { if (s) showCaptureStream(s); })
      .catch(function (e) { window.alert('Could not share the window: ' + e.message); });
  }
  return { renderCaptureSources: renderCaptureSources, chooseCaptureSource: chooseCaptureSource, closeCapturePicker: closeCapturePicker, setCaptureSourceType: setCaptureSourceType, showCaptureStream: showCaptureStream, updateCaptureControls: updateCaptureControls, endCapture: endCapture, stopShare: stopShare, toggleShare: toggleShare, shareScreen: shareScreen };
}
