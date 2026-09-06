import AsyncStorage from '@react-native-async-storage/async-storage';

// Which of an account's gyms this device is looking at (0283). A choice,
// not a fact: the server has no current gym, every RPC takes the gym it
// acts on, so this only decides which membership useGymMembership hands
// the app. Namespaced on the user so a second account signing in on the
// same phone starts from its own oldest gym, which is also why sign-out
// leaves it alone.

function key(userId: string): string {
  return `temple.selected-gym.${userId}`;
}

export async function readSelectedGym(userId: string): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(key(userId))) || null;
  } catch {
    return null;
  }
}

export async function writeSelectedGym(userId: string, gymId: string | null): Promise<void> {
  try {
    if (gymId) await AsyncStorage.setItem(key(userId), gymId);
    else await AsyncStorage.removeItem(key(userId));
  } catch {
    // A choice that did not persist is the oldest gym next time; not an error.
  }
}
