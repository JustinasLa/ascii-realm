// Keep the sound controls available after the movement hint fades away.
import { playGrassFootstep, prepareGrassFootsteps } from './grass-steps.js';
import { setParam } from './voices.js';

export function bindAudioControls(engine, music, weather, onPause = () => {}, root = document) {
  const mute = root.querySelector('#audio-mute');
  const status = root.querySelector('#audio-status');
  const skip = root.querySelector('#audio-skip');
  const song = root.querySelector('#audio-song');
  const seasonSelect = root.querySelector('#audio-season');
  const climate = root.querySelector('#audio-climate');
  const weatherSelect = root.querySelector('#audio-weather');
  const weatherIntensity = root.querySelector('#weather-intensity');
  const weatherDescription = root.querySelector('#weather-description');
  const previewButton = root.querySelector('#grass-preview');
  let previewHandles = [];
  let previewTimer = null;
  let previewGeneration = 0;
  let previewDucked = false;
  let bound = true;
  const stopPreview = () => {
    previewGeneration++;
    clearTimeout(previewTimer);
    previewTimer = null;
    for (const handle of previewHandles) handle.stop();
    previewHandles = [];
    if (previewDucked && engine.context) {
      const now = engine.context.currentTime;
      for (const bus of ['music', 'ambience']) {
        setParam(engine.buses[bus]?.gain, engine.volumes[bus], now, 0.08);
      }
    }
    previewDucked = false;
    previewButton.disabled = false;
    previewButton.textContent = 'Preview grass footsteps';
  };
  const sliders = [...root.querySelectorAll('input[data-volume]')];
  const refresh = () => {
    mute.textContent = engine.muted ? 'Unmute (M)' : 'Mute (M)';
    mute.setAttribute('aria-pressed', String(engine.muted));
    status.textContent = engine.context?.state === 'running'
      ? (engine.muted ? 'Sound muted' : 'Sound enabled')
      : 'Press a key or click to enable sound';
  };
  const unlock = () => { void engine.unlock().then(refresh); };
  // Touch and pen gestures gain user activation on release, unlike the mouse.
  const pointerdown = event => { if (event.pointerType === 'mouse') unlock(); };
  const pointerup = event => { if (event.pointerType !== 'mouse') unlock(); };
  const updateSong = () => {
    const title = music.currentSong;
    if (song.textContent !== title) song.textContent = title;
    if (climate && climate.textContent !== music.climateLabel) climate.textContent = music.climateLabel ?? '';
    if (seasonSelect) seasonSelect.value = music.seasonPreference ?? 'auto';
  };
  const selectSeason = () => { music.setSeason(seasonSelect.value); updateSong(); };
  const skipSong = () => { music.skip(); updateSong(); };
  const previewGrass = async () => {
    stopPreview();
    const generation = previewGeneration;
    previewButton.disabled = true;
    previewButton.textContent = 'Loading footsteps…';
    const unlocked = await engine.unlock();
    const ready = unlocked && await prepareGrassFootsteps(engine);
    if (!bound || generation !== previewGeneration || document.hidden) return;
    previewButton.disabled = false;
    previewButton.textContent = 'Preview grass footsteps';
    if (!ready) {
      status.textContent = 'Footstep audio could not load';
      return;
    }
    const now = engine.context.currentTime;
    for (const bus of ['music', 'ambience']) setParam(engine.buses[bus]?.gain, 0, now, 0.03);
    previewDucked = true;
    previewButton.disabled = true;
    previewButton.textContent = 'Playing grass footsteps…';
    let remaining = 6;
    const nextStep = () => {
      if (!bound || generation !== previewGeneration || document.hidden
          || engine.context?.state !== 'running') {
        stopPreview();
        return;
      }
      previewHandles = previewHandles.filter(handle => !handle.ended);
      previewHandles.push(...playGrassFootstep(engine, { strength: 0.65,
        x: engine.listener.x, y: engine.listener.y }));
      remaining--;
      previewTimer = setTimeout(remaining > 0 ? nextStep : stopPreview, remaining > 0 ? 420 : 550);
    };
    nextStep();
  };
  const updateWeather = () => {
    weatherSelect.value = weather.preset;
    weatherIntensity.value = Math.round(weather.intensity * 100);
    weatherIntensity.nextElementSibling.value = `${weatherIntensity.value}%`;
    weatherDescription.textContent = weather.presets.find(p => p.id === weather.preset)?.description
      ?? 'The meadow’s wind, water and wildlife.';
  };
  const syncClimate = () => {
    music.update?.({ night: music.night, time: music.simulationTime,
      weather: weather.preset, weatherIntensity: weather.intensity });
    updateSong();
  };
  const selectWeather = () => { weather.setPreset(weatherSelect.value); updateWeather(); syncClimate(); };
  const changeIntensity = () => {
    weather.setIntensity(Number(weatherIntensity.value) / 100);
    updateWeather();
    syncClimate();
  };
  for (const season of music.seasonOptions ?? []) {
    const option = document.createElement('option');
    option.value = season.id;
    option.textContent = season.label;
    seasonSelect?.append(option);
  }
  for (const preset of weather.presets) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    weatherSelect.append(option);
  }
  const keydown = event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.code === 'Escape') return;
    // Typing names, server addresses or select options must keep its keys.
    // Inspect the composed path as well, so shadow-root editors are covered.
    const editingTarget = target => target?.isContentEditable
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName?.toUpperCase?.())
      || target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    const editing = editingTarget(event.target) || event.composedPath?.().some(editingTarget);
    if (!event.defaultPrevented && !event.isComposing && !editing && !event.repeat) {
      if (event.code === 'KeyM') engine.toggleMute();
      if (event.code === 'KeyN') skipSong();
    }
    unlock();
    refresh();
  };
  const visibility = () => {
    if (document.hidden) {
      stopPreview();
      onPause();
      void engine.suspend().then(refresh);
    } else if (engine.context) {
      // Resume only an already unlocked context. Some browsers require a
      // fresh gesture; the persistent input listeners provide that retry.
      unlock();
    }
  };
  const muteClick = () => { engine.toggleMute(); refresh(); };
  const volume = event => {
    const slider = event.currentTarget;
    engine.setVolume(slider.dataset.volume, Number(slider.value) / 100);
    slider.nextElementSibling.value = `${slider.value}%`;
  };
  for (const slider of sliders) {
    slider.value = Math.round(engine.volumes[slider.dataset.volume] * 100);
    slider.nextElementSibling.value = `${slider.value}%`;
    slider.addEventListener('input', volume);
  }
  mute.addEventListener('click', muteClick);
  skip.addEventListener('click', skipSong);
  seasonSelect?.addEventListener('change', selectSeason);
  previewButton.addEventListener('click', previewGrass);
  weatherSelect.addEventListener('change', selectWeather);
  weatherIntensity.addEventListener('input', changeIntensity);
  window.addEventListener('keydown', keydown);
  window.addEventListener('pointerdown', pointerdown);
  window.addEventListener('pointerup', pointerup);
  document.addEventListener('visibilitychange', visibility);
  refresh();
  updateSong();
  updateWeather();
  const unbind = () => {
    bound = false;
    stopPreview();
    mute.removeEventListener('click', muteClick);
    skip.removeEventListener('click', skipSong);
    seasonSelect?.removeEventListener('change', selectSeason);
    previewButton.removeEventListener('click', previewGrass);
    weatherSelect.removeEventListener('change', selectWeather);
    weatherIntensity.removeEventListener('input', changeIntensity);
    for (const slider of sliders) slider.removeEventListener('input', volume);
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('pointerdown', pointerdown);
    window.removeEventListener('pointerup', pointerup);
    document.removeEventListener('visibilitychange', visibility);
  };
  unbind.updateSong = updateSong;
  return unbind;
}
