import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import LoginCard from '../components/Auth/LoginCard.js';
import { palette } from '../constants/palette';

const LoginScreen = ({ navigation }) => {
  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: palette.canvas }}>
      <KeyboardAwareScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 26 }}
        enableOnAndroid={true}
        extraScrollHeight={20}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LoginCard navigation={navigation} />
      </KeyboardAwareScrollView>
    </SafeAreaProvider>
  );
};

export default LoginScreen;
