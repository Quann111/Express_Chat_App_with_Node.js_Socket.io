const express = require('express');
const app = express();
const http = require('http').createServer(app);
const bodyParser = require('body-parser');
const urlencodedParser = bodyParser.urlencoded({ extended: false }); // Create urlencodedParser
const path = require('path');
const PORT = process.env.PORT || 3000;
const twilio = require('twilio');
const socketIO = require('socket.io');
const io = socketIO(http);
const moment = require('moment'); // Thêm module moment để định dạng thời gian

// Cấu hình EJS làm công cụ mẫu
app.set('view engine', 'ejs');
// Sử dụng callScript tại đây

http.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});

app.use(express.static(__dirname + '/public'));

// Mongoose database
const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/chat', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => {
        console.log('Connected to MongoDB');
    })
    .catch((error) => {
        console.error('Failed to connect to MongoDB', error);
    });

const User = require('./model/user.model');


const session = require('express-session');

app.use(session({
    secret: 'mã_bí_mật',
    resave: false,
    saveUninitialized: true
}));
// Middleware
function middleware(req, res, next) {
    // Kiểm tra xem người dùng đã đăng nhập hay chưa
    if (req.session && req.session.email) {
        // Người dùng đã đăng nhập, tiếp tục xử lý request
        return next();
    } else {
        // Người dùng chưa đăng nhập, chuyển hướng đến trang đăng nhập
        if (!req.session) {
            req.session = {};
        }
        req.session.redirectMessage = 'Vui lòng đăng nhập để truy cập vào trang chat.';
        return res.redirect("/login");
    }
}
// Middleware phân quyền dựa trên email
function authorizeAdmin(req, res, next) {
    // Kiểm tra xem người dùng đã đăng nhập và có email là "admin@gmail.com" hay không
    if (req.session && req.session.email && req.session.email === "admin@gmail.com") {
        // Người dùng đã đăng nhập và có email là "admin@gmail.com", tiếp tục xử lý request
        return next();
    } else {
        // Người dùng không có quyền truy cập, chuyển hướng đến trang không có quyền hoặc hiển thị thông báo lỗi
        return res.status(403).send("Access denied");
    }
}

// LOGIN
app.get('/login', (req, res) => {
    const redirectMessage = req.session && req.session.redirectMessage ? req.session.redirectMessage : '';
    if (req.session) {
        req.session.redirectMessage = '';
    }

    res.sendFile(path.join(__dirname, 'pages', 'login.html'), { message: redirectMessage });
    //res.sendFile('login', { message: redirectMessage });
});

app.post('/login', urlencodedParser, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });

        if (user) {
            const passwordHash = crypto.createHash('md5').update(req.body.password).digest('hex');

            if (user.password === passwordHash) { // So sánh với mật khẩu đã mã hóa
                if (!req.session) {
                    req.session = {};
                }
                req.session.email = user.email;
                console.log('Đăng nhập thành công');
                res.redirect('/index');
            } else {
                console.log('Đăng nhập thất bại');
                res.redirect('/login');
            }
        } else {
            console.log('Đăng nhập thất bại');
            res.redirect('/login');
        }
    } catch (err) {
        console.error('Lỗi khi đăng nhập', err);
        res.status(500).send('Lỗi khi đăng nhập');
    }
});

//đăng xuất
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Lỗi khi đăng xuất', err);
            res.status(500).send('Lỗi khi đăng xuất');
        } else {
            console.log('Đăng xuất thành công');
            res.redirect('/login');
        }
    });
});


// mã hóa md5
const crypto = require('crypto');
// ĐĂNG KÝ
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/pages/register.html');
});

app.post('/', urlencodedParser, async (req, res) => {
    try {
        const passwordHash = crypto.createHash('md5').update(req.body.password).digest('hex');
        const existingUser = await User.findOne({ email: req.body.email });
        if (existingUser) {
            console.log('Email đã được đăng ký trước đó');
            res.redirect('/'); // Chuyển hướng trở lại trang đăng ký
        } else {
            const result = await User.create({
                Username: req.body.Username,
                password: passwordHash, // Lưu trữ mật khẩu đã mã hóa
                email: req.body.email
            });
            console.log('Tạo người dùng thành công');
            res.redirect('/login');
        }
    } catch (err) {
        console.error('Lỗi khi tạo người dùng', err);
        res.status(500).send('Lỗi khi tạo người dùng');
    }
});


app.get('/chat', middleware, (req, res) => {
    res.sendFile(__dirname + '/pages/CHATindex.html');
});

app.get('/index', middleware, (req, res) => {

    res.render('index');

    // res.sendFile(__dirname + '/index.html');
});


// DB Định nghĩa schema và model cho tin nhắn
const messageSchema = new mongoose.Schema({
    user: String,
    message: String,
    timestamp: String // Thêm trường timestamp để lưu thời gian thực

});


//Lưu tin nhắn vào db
const Message = mongoose.model('Message', messageSchema);
// Xử lý kết nối từ client
io.on('connection', (socket) => {
    console.log('Người dùng đã kết nối');

    // Xử lý sự kiện khi nhận tin nhắn từ client
    socket.on('message', (msg) => {
        // Lưu tin nhắn vào MongoDB
        const newMessage = new Message({
            user: msg.user,
            message: msg.message,
            timestamp: moment().format('YYYY-MM-DD HH:mm:ss') // Lưu thời gian thực
        });

        newMessage.save()
            .then(() => {
                console.log('Tin nhắn đã được lưu vào MongoDB');
            })
            .catch((error) => {
                console.error('Lỗi khi lưu tin nhắn vào MongoDB', error);
            });

        // Gửi tin nhắn đã nhận cho tất cả các client khác
        io.emit('message', msg);
    });

    // Xử lý sự kiện khi client ngắt kết nối
    socket.on('disconnect', () => {
        console.log('Người dùng đã ngắt kết nối');
    });
});

//GỬI FILE

app.get('/upload', middleware, (req, res) => {
    res.sendFile(__dirname + '/pages/uploadFile.html');
});

const multer = require('multer');

const upload = multer({ dest: 'uploads/' });
const fs = require('fs');
app.use(express.static(path.join(__dirname, 'public')));


// Sự kiện kết nối của socket
io.on('connection', (socket) => {
    socket.on('upload', (data) => {
        const file = data.file;
        const fileName = file.filename;
        const filePath = file.path;

        // Xử lý file tại đây, ví dụ: lưu file, kiểm tra định dạng, ...

        // Gửi thông báo cho người dùng thứ 2 để tải về file
        io.emit('download', { fileName });

        // Xóa file tạm sau khi đã xử lý
        fs.unlink(filePath, (err) => {
            if (err) {
                console.error('Error deleting temporary file:', err);
            }
        });
    });
});




// Cấu hình thông tin tài khoản Twilio
const accountSid = 'AC4ff1c8f2ed9704ccce13a12e5385620f';
const authToken = '2bff87454fcedf1fa31b37661d102d4d';
const client = twilio(accountSid, authToken);

// Định nghĩa trang chủ

app.get('/call', middleware, (req, res) => {
    res.sendFile(__dirname + '/pages/call.html');
});

// Tạo phòng video và trả về tên phòng cho người dùng
app.get('/room', (req, res) => {
    client.video.rooms
        .create({ uniqueName: 'my-room' })
        .then(room => {
            res.json({ roomName: room.uniqueName });
        })
        .catch(error => {
            console.log(error);
            res.status(500).json({ error: 'Something went wrong' });
        });
});

// Xử lý kết nối socket
io.on('connection', socket => {
    console.log('A user connected');

    // Lắng nghe sự kiện 'join-room' từ phía Front-End
    socket.on('join-room', roomName => {
        socket.join(roomName);
        console.log(`User joined room: ${roomName}`);
    });

    // Lắng nghe sự kiện 'offer' từ phía Front-End
    socket.on('offer', data => {
        // Gửi thông tin offer cho các thành viên trong phòng
        socket.to(data.roomName).emit('offer', data.offer);
    });

    // Lắng nghe sự kiện 'answer' từ phía Front-End
    socket.on('answer', data => {
        // Gửi thông tin answer cho các thành viên trong phòng
        socket.to(data.roomName).emit('answer', data.answer);
    });

    // Lắng nghe sự kiện 'ice-candidate' từ phía Front-End
    socket.on('ice-candidate', data => {
        // Gửi thông tin ice candidate cho các thành viên trong phòng
        socket.to(data.roomName).emit('ice-candidate', data.candidate);
    });

    // Xử lý sự kiện ngắt kết nối
    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});


//admin

app.get('/admin', authorizeAdmin, middleware, (req, res) => {
    res.sendFile(__dirname + '/pages/admin.html');
});



app.post('/users', async (req, res) => {
    try {
        const { Username, email, password } = req.body;
        const user = new User({ Username, email, password });
        await user.save();
        res.redirect('/users');
    } catch (error) {
        console.error('Lỗi khi tạo người dùng', error);
        res.status(500).send('Lỗi khi tạo người dùng');
    }
});
app.get('/users', middleware, async (req, res) => {
    try {
        const users = await User.find();
        res.render('users', { users });
    } catch (error) {
        console.error('Lỗi khi lấy danh sách người dùng', error);
        res.status(500).send('Lỗi khi lấy danh sách người dùng');
    }
});
app.get('/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        res.render('user', { user });
    } catch (error) {
        console.error('Lỗi khi lấy thông tin người dùng', error);
        res.status(500).send('Lỗi khi lấy thông tin người dùng');
    }
});
app.put('/users/:id', async (req, res) => {
    try {
        const { Username, email, password } = req.body;
        await User.findByIdAndUpdate(req.params.id, { Username, email, password });
        res.redirect('/users');
    } catch (error) {
        console.error('Lỗi khi cập nhật thông tin người dùng', error);
        res.status(500).send('Lỗi khi cập nhật thông tin người dùng');
    }
});
app.delete('/users/:id', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.sendStatus(200);
    } catch (error) {
        console.error('Lỗi khi xóa người dùng', error);
        res.sendStatus(500);
    }
});