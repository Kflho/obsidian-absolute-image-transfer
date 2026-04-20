// 注意这里的每一个 \ 都变成了 \\ 
const content ='![](file:///D:\\local_data\\software_data\\tool_data\\communicate_data\\QQdata\\Tencent%20Files\\542386598\\Image\\C2C\\58`7R\\(F{BB37HFZ7$@FL%_H.png)  ';

const regex = /!\[(.*?)\]\((<?(?:file:\/\/\/|[a-zA-Z]:[\\/]).*?\.(?:png|jpg|jpeg|gif|bmp|webp|heic)>?)(?:[ \t]+["'].*?["'])?\)/gi;

const matches = [...content.matchAll(regex)];
console.log(matches);