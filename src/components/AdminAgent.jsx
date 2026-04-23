import { useState } from "react";
import { sendToAgent } from "../api/agent";

export default function AdminAgent() {
  const [msg, setMsg] = useState("");
  const [chat, setChat] = useState([]);

  const send = async () => {
    const res = await sendToAgent(msg);

    setChat([...chat, { user: msg, bot: res.final }]);
    setMsg("");
  };

  return (
    <div>
      <h2>Agente IA Admin</h2>

      {chat.map((c, i) => (
        <div key={i}>
          <b>Tú:</b> {c.user}
          <br />
          <b>Agente:</b> {c.bot}
        </div>
      ))}

      <input value={msg} onChange={e => setMsg(e.target.value)} />
      <button onClick={send}>Enviar</button>
    </div>
  );
}
