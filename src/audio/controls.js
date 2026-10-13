// Keep the sound controls available after the movement hint fades away.
export function bindAudioControls(engine, music, onPause = () => {}, root = document.getElementById('audio-controls')) {
  const mute = root.querySelector('#audio-mute');
  const status = root.querySelector('#audio-status');
  const skip = root.querySelector('#audio-skip');
  const song = root.querySelector('#audio-song');
  const sliders = [...root.querySelectorAll('input[data-volume]')];
  const refresh = () => {
    mute.textContent = engine.muted ? 'Unmute (M)' : 'Mute (M)';
    mute.setAttribute('aria-pressed', String(engine.muted));
    status.textContent = engine.context?.state === 'running'
      ? (engine.muted ? 'Sound muted' : 'Sound enabled')
      : 'Press a key or click to enable sound';
  };
  const unlock = () => { void engine.unlock().then(refresh); };
  const updateSong = () => {
    const title = music.currentSong;
    if (song.textContent !== title) song.textContent = title;
  };
  const skipSong = () => { music.skip(); updateSong(); };
  const keydown = event => {
    if (event.code === 'KeyM' && !event.repeat) engine.toggleMute();
    if (event.code === 'KeyN' && !event.repeat) skipSong();
    unlock();
    refresh();
  };
  const visibility = () => {
    if (document.hidden) {
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
  window.addEventListener('keydown', keydown);
  window.addEventListener('pointerdown', unlock);
  document.addEventListener('visibilitychange', visibility);
  refresh();
  updateSong();
  const unbind = () => {
    mute.removeEventListener('click', muteClick);
    skip.removeEventListener('click', skipSong);
    for (const slider of sliders) slider.removeEventListener('input', volume);
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('pointerdown', unlock);
    document.removeEventListener('visibilitychange', visibility);
  };
  unbind.updateSong = updateSong;
  return unbind;
}
