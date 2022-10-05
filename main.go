package main

import (
	"log"
	"net/http"

	"github.com/kmsdoit/chatserver/server"

	"github.com/gorilla/websocket"
)

type Message struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Message  string `json:"message"`
}

var clients = make(map[*websocket.Conn]bool) // 접속된 클라이언트
var broadcast = make(chan Message)           // 메세지 브로드캐스트
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}          // 업그레이드

func handleConnections(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)

	if err != nil {
		log.Fatal(err)
	}

	defer ws.Close()

	clients[ws] = true

	for {
		var msg Message
		err := ws.ReadJSON(&msg)
		if err != nil {
			log.Printf("error: %v", err)
			delete(clients, ws)
			break
		}
		broadcast <- msg
	}
}

func handleMessages() {
	for {
		msg := <-broadcast
		for client := range clients {
			err := client.WriteJSON(msg)
			if err != nil {
				log.Printf("error : %v ", err)
				defer client.Close()
				delete(clients, client)
			}
		}
	}
}

func main() {

	server.AllRooms.Init()

	fs := http.FileServer(http.Dir("./public"))
	bs := http.FileServer(http.Dir("./main"))
	http.Handle("/screen/", http.StripPrefix("/screen/", fs))
	http.Handle("/", bs)

	http.HandleFunc("/ws", handleConnections)
	http.HandleFunc("/create", server.CreateRoomRequestHandler)
	http.HandleFunc("/join", server.JoinRoomRequestHandler)
	go handleMessages()

	log.Println("http server started on :8091")
	err := http.ListenAndServe(":8091", nil)

	if err != nil {
		log.Fatal("ListenAndServe : ", err)
	}
}
