// TODO: Wire React Navigation stack here.
import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { View, Text } from 'react-native';


//placeholder for now
const PlaceholderScreen = () => (
  <View className="flex-1 items-center justify-center bg-gray-900">
    <Text>Welcome to Aura Thesis App!</Text>
  </View>
);

const Stack = createStackNavigator();

const AppNavigator = () => {
    return (
        <Stack.Navigator
        initialRouteName='Home'
            screenOptions={{
            headerStyle: { backgroundColor: '#1e1e1e' }, // Dark mode look
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },  
            }}>
            <Stack.Screen 
            name="Home" 
            component={PlaceholderScreen} />
        </Stack.Navigator>
    )
}




export default AppNavigator;
