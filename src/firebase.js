import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAML65bhu_Kf_oQxOI2zvUE5G_9XVC-evE",
  authDomain: "naratograph.firebaseapp.com",
  databaseURL: "https://naratograph-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "naratograph",
  storageBucket: "naratograph.firebasestorage.app",
  messagingSenderId: "1081021981163",
  appId: "1:1081021981163:web:7edbc1e6e254be119bf9ae",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
