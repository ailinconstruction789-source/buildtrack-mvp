import { useState, useEffect } from 'react';

export function useWeather() {
  const [weatherInfo, setWeatherInfo] = useState<any>(null);

  const getWeatherDetails = (code: number) => {
    if (code === 0) return { icon: '☀️', text: 'ฟ้าใส แดดแรง' };
    if (code === 1 || code === 2) return { icon: '🌤️', text: 'มีเมฆบางส่วน' };
    if (code === 3) return { icon: '☁️', text: 'เมฆหนาตึบ' };
    if (code >= 45 && code <= 48) return { icon: '🌫️', text: 'มีหมอก' };
    if (code >= 51 && code <= 67) return { icon: '🌧️', text: 'ฝนตก' };
    if (code >= 80 && code <= 82) return { icon: '⛈️', text: 'ฝนตกหนัก' };
    if (code >= 95) return { icon: '🌩️', text: 'พายุฝนฟ้าคะนอง' };
    return { icon: '🌡️', text: 'สภาพอากาศปกติ' };
  };

  // 🌟 ฟังก์ชันจำลองสภาพอากาศล่วงหน้า 4 ชั่วโมง (ใช้กรณี API ภายนอกไม่ตอบสนองหรือถูกบล็อก)
  const generateFallbackHourlyForecast = (baseHour?: number) => {
    const currentHour = baseHour !== undefined ? baseHour : new Date().getHours();
    const hourly = [];
    const getHourProfile = (h: number) => {
      const hour = h % 24;
      if (hour >= 6 && hour < 9) return { temp: 28, icon: '🌤️', text: 'มีเมฆบางส่วน', rainProb: 10, uv: 3 };
      if (hour >= 9 && hour < 12) return { temp: 32, icon: '☀️', text: 'ฟ้าใส แดดแรง', rainProb: 15, uv: 7 };
      if (hour >= 12 && hour < 15) return { temp: 34, icon: '☀️', text: 'แดดแรงจัด', rainProb: 20, uv: 9 };
      if (hour >= 15 && hour < 18) return { temp: 32, icon: '🌤️', text: 'มีเมฆบางส่วน', rainProb: 30, uv: 5 };
      if (hour >= 18 && hour < 21) return { temp: 29, icon: '⛅', text: 'อากาศเย็นลง', rainProb: 25, uv: 0 };
      return { temp: 26, icon: '🌙', text: 'ท้องฟ้าแจ่มใส', rainProb: 10, uv: 0 };
    };

    for (let i = 1; i <= 4; i++) {
      const targetHour = (currentHour + i) % 24;
      const profile = getHourProfile(targetHour);
      hourly.push({
        time: `${String(targetHour).padStart(2, '0')}:00`,
        temp: profile.temp,
        details: { icon: profile.icon, text: profile.text },
        rainProb: profile.rainProb,
        uv: profile.uv
      });
    }

    const currentProfile = getHourProfile(currentHour);
    let alert = null;
    if (currentProfile.uv >= 8) {
      alert = { type: 'uv-high', msg: '🔴 UV รุนแรงมาก! หลีกเลี่ยงการตากแดดต่อเนื่อง' };
    } else if (currentProfile.uv >= 5) {
      alert = { type: 'uv-med', msg: '🟠 แดดแรง ทาครีมกันแดดและดื่มน้ำบ่อยๆ นะครับ' };
    }

    return { hourly, currentProfile, alert };
  };

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    const { signal } = controller;

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        if (!isMounted || signal.aborted) return;
        const { latitude, longitude } = position.coords;

        // 1. ดึงชื่อสถานที่จริงของผู้ใช้งาน (Reverse Geocoding)
        let placeName = "";
        try {
          const locRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=th`, { signal });
          if (locRes.ok) {
            const locData = await locRes.json();
            const district = locData.localityInfo?.administrative?.find((a: any) => a.adminLevel === 6)?.name || locData.locality || locData.city || '';
            const province = locData.localityInfo?.administrative?.find((a: any) => a.adminLevel === 4)?.name || locData.principalSubdivision || '';
            if (district && province && district !== province) {
              placeName = `${district}, ${province}`;
            } else {
              placeName = district || province || '';
            }
          }
        } catch {
          // หาก BigDataCloud ไม่ตอบสนอง
        }

        // หากยังไม่ได้ชื่อสถานที่ ให้ลองสำรองด้วย Nominatim (OpenStreetMap)
        if (!placeName && !signal.aborted) {
          try {
            const osmRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=th`, { signal });
            if (osmRes.ok) {
              const osmData = await osmRes.json();
              const addr = osmData.address;
              const d = addr?.district || addr?.city_district || addr?.suburb || addr?.county || addr?.city || '';
              const p = addr?.province || addr?.state || '';
              if (d && p && d !== p) {
                placeName = `${d}, ${p}`;
              } else {
                placeName = d || p || '';
              }
            }
          } catch {
            // สำรองไม่สำเร็จ
          }
        }

        const finalLocation = placeName || "ตำแหน่งปัจจุบัน";

        if (!isMounted || signal.aborted) return;

        // 2. ดึงสภาพอากาศ (ปัจจุบัน + ล่วงหน้ารายชั่วโมง + UV)
        try {
          const weatherController = new AbortController();
          const weatherTimeout = setTimeout(() => weatherController.abort(), 4000);
          const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code,precipitation_probability,uv_index&timezone=auto&forecast_days=2`, { signal: weatherController.signal });
          clearTimeout(weatherTimeout);

          if (!weatherRes.ok) throw new Error(`Open-Meteo HTTP ${weatherRes.status}`);
          const wData = await weatherRes.json();

          const currentHour = new Date().getHours();
          let nextHours = wData.hourly?.time?.slice(currentHour + 1, currentHour + 5).map((time: string, idx: number) => ({
            time: new Date(time).getHours() + ":00",
            temp: Math.round(wData.hourly.temperature_2m[currentHour + 1 + idx]),
            details: getWeatherDetails(wData.hourly.weather_code[currentHour + 1 + idx]),
            rainProb: wData.hourly.precipitation_probability[currentHour + 1 + idx]
          })) || [];

          if (!nextHours || nextHours.length < 4) {
            nextHours = generateFallbackHourlyForecast(currentHour).hourly;
          }

          const currentUV = wData.hourly?.uv_index?.[currentHour] || 0;
          const willRain = nextHours.some((h: any) => h.rainProb > 50);

          let alert = null;
          if (willRain) alert = { type: 'rain', msg: '🔵 มีโอกาสฝนตกในอีกไม่กี่ชั่วโมง เตรียมคลุมวัสดุ!' };
          else if (currentUV > 8) alert = { type: 'uv-high', msg: '🔴 UV รุนแรงมาก! หลีกเลี่ยงการตากแดดต่อเนื่อง' };
          else if (currentUV > 5) alert = { type: 'uv-med', msg: '🟠 แดดแรง ทาครีมกันแดดและดื่มน้ำบ่อยๆ นะครับ' };

          if (isMounted) {
            setWeatherInfo({
              location: finalLocation,
              currentTemp: Math.round(wData.current?.temperature_2m || 0),
              currentDetails: getWeatherDetails(wData.current?.weather_code || 0),
              hourly: nextHours,
              alert: alert
            });
          }
        } catch (e: any) {
          if (isMounted) {
            const fallbackData = generateFallbackHourlyForecast();
            setWeatherInfo({
              location: finalLocation,
              currentTemp: fallbackData.currentProfile.temp,
              currentDetails: { icon: fallbackData.currentProfile.icon, text: fallbackData.currentProfile.text },
              hourly: fallbackData.hourly,
              alert: fallbackData.alert
            });
          }
        }
      }, (error) => {
        if (!isMounted) return;
        const fallbackData = generateFallbackHourlyForecast();
        setWeatherInfo({
          location: "ตำแหน่งปัจจุบัน",
          currentTemp: fallbackData.currentProfile.temp,
          currentDetails: { icon: fallbackData.currentProfile.icon, text: fallbackData.currentProfile.text },
          hourly: fallbackData.hourly,
          alert: fallbackData.alert
        });
      }, { timeout: 10000, maximumAge: 60000 });
    } else {
      if (isMounted) {
        const fallbackData = generateFallbackHourlyForecast();
        setWeatherInfo({
          location: "ตำแหน่งปัจจุบัน",
          currentTemp: fallbackData.currentProfile.temp,
          currentDetails: { icon: fallbackData.currentProfile.icon, text: fallbackData.currentProfile.text },
          hourly: fallbackData.hourly,
          alert: fallbackData.alert
        });
      }
    }
    return () => { isMounted = false; controller.abort(); };
  }, []);

  return weatherInfo;
}
