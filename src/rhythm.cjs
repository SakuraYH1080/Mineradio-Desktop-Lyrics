// Live features come only from validated local PCM analysis. The oscillator is demo-only.
function motion({ demo = false, playing = false, time = 0, audio = null, now = Date.now() } = {}) {
  const age = audio ? now - audio.observedAtMs : Infinity;
  if (!demo && playing && audio?.source === "inflink-pcm" && age >= 0 && age <= 500) {
    const decay = Math.exp(-age/220);
    return {lyricGlow:true,lyricGlowBeat:true,lyricGlowStrength:.35,highBloom:0,
      beatPulse:Math.max(0,Math.min(1.4,audio.beatPulse))*Math.exp(-age/160),
      bass:Math.max(0,Math.min(1.2,audio.bass))*decay,
      beatGlow:Math.max(0,Math.min(1.7,audio.beatGlow))*decay};
  }
  const pulse =
    demo && playing
      ? Math.pow(Math.max(0, Math.sin(time * Math.PI * 2)), 10)
      : 0;
  return {
    lyricGlow: true,
    lyricGlowBeat: demo,
    lyricGlowStrength: 0.35,
    highBloom: 0,
    beatPulse: Math.min(1.4, pulse),
    bass: Math.min(1.2, pulse * 0.65),
    beatGlow: Math.min(1.7, pulse * 1.2),
  };
}
module.exports = { motion };
