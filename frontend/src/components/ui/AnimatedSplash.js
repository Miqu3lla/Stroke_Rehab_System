import { useEffect, useRef } from 'react';
import { View, Image, Animated, StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('screen');

// A single pulsing dot. Staggers its opacity animation based on `delay`
// so the three dots appear to pulse in sequence left → right.
function PulsingDot({ delay }) {
  const opacity = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.delay(Math.max(0, 800 - delay)),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return <Animated.View style={[styles.dot, { opacity }]} />;
}

// Full-screen splash with the app image covering the entire screen and
// three pulsing dots pinned near the bottom as an overlay.
export default function AnimatedSplash() {
  return (
    <View style={styles.container}>
      {/* Image sized explicitly to fill the screen */}
      <Image
        source={require('../../../assets/theramotion-splash.png')}
        style={styles.image}
        resizeMode="cover"
      />

      {/* Dots absolutely pinned above the bottom edge */}
      <View style={styles.dotsRow}>
        <PulsingDot delay={0} />
        <PulsingDot delay={200} />
        <PulsingDot delay={400} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SCREEN_W,
    height: SCREEN_H,
  },
  image: {
    width: SCREEN_W,
    height: SCREEN_H,
  },
  dotsRow: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
});
